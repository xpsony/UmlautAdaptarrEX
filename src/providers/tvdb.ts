import { request } from "undici";
import type { Logger } from "pino";
import type { MediaType } from "@/domain/variations/generate";
import { describeError } from "@/lib/error-format";
import { HostRateLimiter } from "./rate-limit";
import {
  makeTitlePayload,
  type BulkFetchOptions,
  type TitlePayload,
  type TitleProvider,
} from "./types";

interface TvdbProviderOptions {
  apiKey: string;
  pin?: string | null | undefined;
  userAgent: string;
  logger?: Logger | undefined;
}

const TVDB_HOST = "api4.thetvdb.com";
const TVDB_BASE = `https://${TVDB_HOST}/v4`;

// TVDB v4 publishes no explicit rate ceiling, just a "don't spam" guideline.
// 100 ms between request starts caps us at 10 req/s - conservative for a
// service that handles millions of calls per day across all users, but well
// below anything that could be construed as spam from a single integration.
// Each fetchByExternalId issues 1–3 calls (resolve + translations [+ extended
// fallback]), so 10 req/s translates to ~3–10 items/s end-to-end.
const TVDB_MIN_INTERVAL_MS = 100;

// Parallel in-flight bulk lookups. Lower than TMDB because each TVDB lookup
// can itself fan out to multiple HTTP calls; 5 keeps the limiter busy without
// flooding the API with bursts of nested calls.
const TVDB_BULK_CONCURRENCY = 5;

// TVDB v4 uses ISO 639-3 (three-letter codes) for translations and aliases.
// The rest of the app uses ISO 639-1 codes ("de", "en", ...), so we map both
// directions. The inverse map is used while parsing translations so we cache
// consistently in 639-1.
const LANG_1_TO_3: Readonly<Record<string, string>> = {
  de: "deu",
  en: "eng",
  sv: "swe",
  fr: "fra",
  es: "spa",
  it: "ita",
  pt: "por",
  ja: "jpn",
  ko: "kor",
  zh: "zho",
  ru: "rus",
  pl: "pol",
  nl: "nld",
  tr: "tur",
};

const LANG_3_TO_1: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LANG_1_TO_3).map(([a, b]) => [b, a]),
);

function toIso6393(lang1: string): string | null {
  return LANG_1_TO_3[lang1.toLowerCase()] ?? null;
}

function toIso6391(lang3: string): string | null {
  return LANG_3_TO_1[lang3.toLowerCase()] ?? null;
}

export type TvdbProbeResult =
  | { ok: true; sample: { id: number; title: string } }
  | {
      ok: false;
      code: "missing" | "unauthorized" | "network" | "unknown";
      detail?: string;
    };

interface TvdbLoginResponse {
  status?: string;
  data?: { token?: string };
  message?: string;
}

interface TvdbTranslationResponse {
  status?: string;
  data?: {
    name?: string | null;
    language?: string;
    aliases?: string[];
  };
}

interface TvdbExtendedResponse {
  status?: string;
  data?: {
    id?: number;
    name?: string;
    /**
     * ISO 639-3 code of the record's original language ("deu", "eng", ...).
     * For a German production TVDB frequently stores the German title in
     * `name` and offers only an `eng` name translation, so this field is the
     * only way to learn that `name` IS the German title.
     */
    originalLanguage?: string;
    aliases?: { language?: string; name?: string }[];
    translations?: {
      nameTranslations?: {
        name?: string;
        language?: string;
        /** True when the entry is an alternate spelling, not the title. */
        isAlias?: boolean;
        isPrimary?: boolean;
      }[];
      aliases?: { language?: string; name?: string }[];
    };
  };
}

interface TvdbRemoteIdResponse {
  status?: string;
  data?: {
    movie?: { id?: number; name?: string };
    series?: { id?: number; name?: string };
  }[];
}

/**
 * Quick smoke-test for a TVDB v4 API key (+ optional Pin). Tries to log in
 * and then performs a small GET against a long-lived public series id.
 * Returns a UI-friendly result so the Settings test button stays consistent
 * with the TMDB variant.
 */
export async function probeTvdbKey(
  apiKey: string,
  pin?: string | null | undefined,
): Promise<TvdbProbeResult> {
  if (!apiKey) return { ok: false, code: "missing" };
  try {
    const token = await tvdbLogin(apiKey, pin ?? null);
    const res = await request(`${TVDB_BASE}/series/121361`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    if (res.statusCode === 401) {
      return { ok: false, code: "unauthorized" };
    }
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      return {
        ok: false,
        code: "unknown",
        detail: `HTTP ${res.statusCode}: ${text.slice(0, 160)}`,
      };
    }
    const json = (await res.body.json()) as TvdbExtendedResponse;
    const title = json.data?.name ?? "Sample Series";
    return { ok: true, sample: { id: 121361, title } };
  } catch (err) {
    const status = (err as { __status?: number }).__status;
    if (status === 401) return { ok: false, code: "unauthorized" };
    return {
      ok: false,
      code: status ? "unknown" : "network",
      detail: describeError(err).slice(0, 240),
    };
  }
}

async function tvdbLogin(apiKey: string, pin: string | null): Promise<string> {
  const body: { apikey: string; pin?: string } = { apikey: apiKey };
  if (pin && pin.trim().length > 0) body.pin = pin.trim();
  const res = await request(`${TVDB_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    bodyTimeout: 10_000,
    headersTimeout: 10_000,
  });
  if (res.statusCode === 401 || res.statusCode === 403) {
    const err = new Error("TVDB rejected the API key") as Error & {
      __status?: number;
    };
    err.__status = res.statusCode;
    throw err;
  }
  if (res.statusCode >= 400) {
    const text = await res.body.text();
    const err = new Error(
      `TVDB login failed: HTTP ${res.statusCode} ${text.slice(0, 160)}`,
    ) as Error & { __status?: number };
    err.__status = res.statusCode;
    throw err;
  }
  const json = (await res.body.json()) as TvdbLoginResponse;
  const token = json.data?.token;
  if (!token) {
    throw new Error(`TVDB login response missing token: ${JSON.stringify(json).slice(0, 160)}`);
  }
  return token;
}

/**
 * TVDB v4 title provider. Login -> cache JWT -> series/movies translations.
 * On 401 (token expired) we re-login exactly once and retry the request.
 *
 * Language output: TVDB returns one title plus aliases per language. The
 * provider returns the translation entry for each requested `langs` (BCP-47
 * short code); the `extended` response supplies aliases.
 *
 * Movies require TVDB's internal movie id, not the TMDB id Radarr supplies.
 * We resolve TMDB -> TVDB per sync via `/v4/search/remoteid/{id}` and cache
 * the result in-memory on the instance provider.
 */
export class TvdbProvider implements TitleProvider {
  readonly name = "tvdb";
  private readonly limiter = new HostRateLimiter(TVDB_MIN_INTERVAL_MS);
  private readonly log: Logger | null;
  private token: string | null = null;
  // Single-flight login guard: when several concurrent requests need a token
  // and none is cached, only the first triggers tvdbLogin; the rest await the
  // same in-flight promise instead of each launching their own login.
  private tokenPromise: Promise<string> | null = null;
  private readonly remoteIdCache = new Map<string, number | null>();

  constructor(private readonly opts: TvdbProviderOptions) {
    if (!opts.apiKey) {
      throw new Error("TvdbProvider requires an API key");
    }
    this.log = opts.logger?.child({ provider: "tvdb" }) ?? null;
  }

  supportedLanguages(): readonly string[] {
    return ["*"];
  }

  async fetchByExternalId(
    type: MediaType,
    externalId: string,
    langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    if (type !== "tv" && type !== "movie") return null;
    const wantedLangs = langs && langs.length > 0 ? Array.from(langs) : ["de"];

    let internalId: number | null = null;
    if (type === "tv") {
      const idNum = Number(externalId);
      if (!Number.isFinite(idNum) || idNum <= 0) return null;
      internalId = idNum;
    } else {
      // Movies arrive with a TMDB id, so resolve to the TVDB internal id first.
      internalId = await this.resolveMovieId(externalId);
      if (internalId === null) return null;
    }

    const titlesByLang: Record<string, string> = {};
    const aliasesByLang: Record<string, string[]> = {};

    // 1) Translations per language (TVDB has no bulk endpoint).
    for (const lang1 of wantedLangs) {
      const lang3 = toIso6393(lang1);
      if (!lang3) continue;
      const path =
        type === "tv"
          ? `/series/${internalId}/translations/${lang3}`
          : `/movies/${internalId}/translations/${lang3}`;
      try {
        const data = await this.authedGet<TvdbTranslationResponse>(path);
        const t = data?.data;
        const name = t?.name?.trim();
        if (name) titlesByLang[lang1] = name;
        if (t?.aliases && t.aliases.length > 0) {
          const cleaned = t.aliases.filter((a) => a && a.length > 0);
          if (cleaned.length > 0) aliasesByLang[lang1] = cleaned;
        }
      } catch (err) {
        const status = (err as { __status?: number }).__status;
        if (status === 404) continue;
        this.log?.warn(
          { externalId, internalId, type, lang1, status, err },
          "tvdb translation lookup failed",
        );
      }
    }

    // 2) Extended returns name + originalLanguage + nameTranslations +
    //    aliases in a single response. We reach for it when either half of
    //    step 1 came back short:
    //
    //      a) a wanted language has no title. `/translations/{lang3}` only
    //         answers for languages that actually carry a *translation
    //         record*. A German production is routinely stored with the
    //         German title in `name` (originalLanguage = "deu") and only an
    //         `eng` name translation on top - which is exactly what Sonarr
    //         then displays. Without this fallback such a series ends up with
    //         germanTitle = null and the search never asks the indexer for
    //         the German name at all.
    //      b) no per-language aliases were returned (the translations
    //         endpoint exposes an aliases array but it is not always
    //         populated depending on the subscription tier).
    //
    //    Both cases share one HTTP call, so a fully-resolved item still costs
    //    nothing extra.
    const missingLangs = wantedLangs.filter((l) => !titlesByLang[l]);
    if (missingLangs.length > 0 || Object.keys(aliasesByLang).length === 0) {
      const path =
        type === "tv" ? `/series/${internalId}/extended` : `/movies/${internalId}/extended`;
      try {
        const data = await this.authedGet<TvdbExtendedResponse>(path);
        const record = data?.data;

        // 2a-i) Named translations embedded in the extended record. Entries
        //       flagged `isAlias` are alternate spellings, not the title, so
        //       they go to the alias bucket instead of the title slot.
        for (const nt of record?.translations?.nameTranslations ?? []) {
          const name = nt.name?.trim();
          if (!name) continue;
          const lang1 = toIso6391(nt.language?.toLowerCase() ?? "");
          if (!lang1 || !wantedLangs.includes(lang1)) continue;
          if (nt.isAlias) {
            const bucket = aliasesByLang[lang1] ?? [];
            if (!bucket.includes(name)) bucket.push(name);
            aliasesByLang[lang1] = bucket;
            continue;
          }
          if (!titlesByLang[lang1]) titlesByLang[lang1] = name;
        }

        // 2a-ii) Last resort for a still-missing language: the record's own
        //        `name`, but only when `originalLanguage` proves it is in
        //        that language. Guessing from `name` alone would file an
        //        English title as the German one.
        const originalLang1 = toIso6391(record?.originalLanguage?.toLowerCase() ?? "");
        const recordName = record?.name?.trim();
        if (
          originalLang1 &&
          recordName &&
          wantedLangs.includes(originalLang1) &&
          !titlesByLang[originalLang1]
        ) {
          titlesByLang[originalLang1] = recordName;
          this.log?.debug(
            {
              externalId,
              internalId,
              type,
              lang: originalLang1,
              title: recordName,
            },
            "tvdb: used the record's primary name as the original-language title",
          );
        }

        // 2b) Per-language aliases.
        for (const a of record?.aliases ?? []) {
          if (!a.name) continue;
          const lang1 = toIso6391(a.language?.toLowerCase() ?? "");
          if (!lang1) continue;
          if (!wantedLangs.includes(lang1)) continue;
          const bucket = aliasesByLang[lang1] ?? [];
          if (!bucket.includes(a.name)) bucket.push(a.name);
          aliasesByLang[lang1] = bucket;
        }
      } catch (err) {
        const status = (err as { __status?: number }).__status;
        if (status !== 404) {
          this.log?.warn(
            { externalId, internalId, type, status, err },
            "tvdb extended lookup failed",
          );
        }
      }
    }

    const titleLangs = Object.keys(titlesByLang);
    if (titleLangs.length === 0 && Object.keys(aliasesByLang).length === 0) {
      this.log?.debug(
        { externalId, internalId, type, wantedLangs },
        "tvdb returned no usable translations or aliases",
      );
      return null;
    }

    // Representative title for the log. Prefer DE since TVDB is mainly
    // queried for German titles in this project; fall back to anything
    // available so the operator can still identify the work in logs.
    const representative = titlesByLang["de"] ?? titlesByLang[titleLangs[0]!] ?? null;
    this.log?.debug(
      {
        externalId,
        internalId,
        type,
        title: representative,
        germanTitle: titlesByLang["de"] ?? null,
        translations: titleLangs,
        aliasLangs: Object.keys(aliasesByLang),
      },
      "tvdb lookup",
    );

    return makeTitlePayload({
      titlesByLang,
      aliasesByLang: Object.keys(aliasesByLang).length > 0 ? aliasesByLang : undefined,
      externalId,
    });
  }

  async fetchByTitle(): Promise<TitlePayload | null> {
    return null;
  }

  async fetchBulk(
    type: MediaType,
    externalIds: string[],
    langs?: readonly string[],
    opts?: BulkFetchOptions,
  ): Promise<Map<string, TitlePayload>> {
    const out = new Map<string, TitlePayload>();
    if (type !== "tv" && type !== "movie") return out;
    if (externalIds.length === 0) return out;

    this.log?.info(
      {
        type,
        count: externalIds.length,
        langs: langs ?? ["de"],
        concurrency: TVDB_BULK_CONCURRENCY,
        minIntervalMs: TVDB_MIN_INTERVAL_MS,
      },
      "tvdb bulk request",
    );
    let resolved = 0;
    for (let i = 0; i < externalIds.length; i += TVDB_BULK_CONCURRENCY) {
      const batch = externalIds.slice(i, i + TVDB_BULK_CONCURRENCY);
      await Promise.all(
        batch.map(async (id) => {
          const p = await this.fetchByExternalId(type, id, langs);
          if (!p) return;
          out.set(id, p);
          if (Object.keys(p.titlesByLang).length > 0) resolved += 1;
          // Stream per-id result so callers can persist immediately.
          if (opts?.onItem) {
            try {
              await opts.onItem(id, p);
            } catch (err) {
              this.log?.warn({ externalId: id, err }, "tvdb bulk onItem callback failed");
            }
          }
        }),
      );
    }
    this.log?.info({ type, requested: externalIds.length, withTitles: resolved }, "tvdb bulk done");
    return out;
  }

  /** For movies: TMDB id -> TVDB movie id via /search/remoteid. */
  private async resolveMovieId(tmdbId: string): Promise<number | null> {
    const cached = this.remoteIdCache.get(tmdbId);
    if (cached !== undefined) return cached;
    try {
      const data = await this.authedGet<TvdbRemoteIdResponse>(
        `/search/remoteid/${encodeURIComponent(tmdbId)}`,
      );
      const list = data?.data ?? [];
      let found: number | null = null;
      for (const entry of list) {
        const movieId = entry.movie?.id;
        if (typeof movieId === "number" && movieId > 0) {
          found = movieId;
          break;
        }
      }
      this.remoteIdCache.set(tmdbId, found);
      return found;
    } catch (err) {
      const status = (err as { __status?: number }).__status;
      if (status === 404) {
        this.remoteIdCache.set(tmdbId, null);
        return null;
      }
      this.log?.warn({ tmdbId, status, err }, "tvdb remoteid lookup failed - skipping movie");
      return null;
    }
  }

  /**
   * Return a valid JWT, logging in at most once across concurrent callers.
   * If a token is cached we return it directly; otherwise the first caller
   * starts the login and every concurrent caller awaits the same promise.
   * The promise is cleared on both success and failure so a later attempt
   * (e.g. after a 401) can re-login cleanly via this same path.
   */
  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    if (!this.tokenPromise) {
      this.tokenPromise = tvdbLogin(this.opts.apiKey, this.opts.pin ?? null).then(
        (token) => {
          this.token = token;
          this.tokenPromise = null;
          return token;
        },
        (err) => {
          // Clear the in-flight promise so the next call retries login
          // instead of awaiting a permanently-rejected promise.
          this.tokenPromise = null;
          throw err;
        },
      );
    }
    return this.tokenPromise;
  }

  private async authedGet<T>(path: string): Promise<T> {
    await this.limiter.wait(TVDB_HOST);
    const doRequest = async (): Promise<T> => {
      const token = await this.ensureToken();
      const res = await request(`${TVDB_BASE}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": this.opts.userAgent,
        },
        bodyTimeout: 30_000,
        headersTimeout: 30_000,
      });
      if (res.statusCode === 401) {
        const err = new Error("TVDB token expired") as Error & {
          __status?: number;
        };
        err.__status = 401;
        throw err;
      }
      if (res.statusCode === 404) {
        const err = new Error("TVDB resource not found") as Error & {
          __status?: number;
        };
        err.__status = 404;
        throw err;
      }
      if (res.statusCode >= 400) {
        const text = await res.body.text();
        const err = new Error(
          `TVDB ${path}: HTTP ${res.statusCode} ${text.slice(0, 160)}`,
        ) as Error & { __status?: number };
        err.__status = res.statusCode;
        throw err;
      }
      return (await res.body.json()) as T;
    };

    // Explicit attempt counter so a future change can't accidentally make
    // this recursive - if the first 401 retry also returns 401 we surface
    // the error to the caller instead of looping.
    const MAX_ATTEMPTS = 2;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await doRequest();
      } catch (err) {
        lastErr = err;
        const status = (err as { __status?: number }).__status;
        if (status === 401 && attempt < MAX_ATTEMPTS) {
          // Re-login on the next attempt - token may have expired. Clear both
          // the cached token and any in-flight login promise so the next
          // ensureToken() starts a fresh single-flight login.
          this.token = null;
          this.tokenPromise = null;
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
