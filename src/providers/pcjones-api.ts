import { request } from "undici";
import type { Logger } from "pino";
import type { MediaType } from "@/domain/variations/generate";
import { HostRateLimiter } from "./rate-limit";
import {
  makeTitlePayload,
  type BulkFetchOptions,
  type TitlePayload,
  type TitleProvider,
} from "./types";

interface PcjonesApiOptions {
  host: string;
  userAgent: string;
  logger?: Logger | undefined;
}

/**
 * pcjones API response shapes (verified against C# predecessor and live traffic).
 *  - GET `?tvdbid=…`          → `{ status, germanTitle, originalTitle?, aliases? }`
 *  - GET `?title=…`           → as above plus `tvdbId`
 *  - POST `?bulk=true { tvdbIds }` → `{ status, data: [{ tvdbId, germanTitle, … }] }`
 *
 * `aliases` is normally `{ language, name }[]`; we also accept plain `string[]`
 * to tolerate older/parallel backends.
 */
interface AliasObj {
  language?: string;
  name?: string;
}

interface BulkEntry {
  tvdbId: number | string;
  germanTitle?: string | null;
  originalTitle?: string | null;
  aliases?: AliasObj[] | string[];
  expirationDate?: string;
}

interface SingleEntry {
  status?: string;
  germanTitle?: string | null;
  originalTitle?: string | null;
  tvdbId?: number | string;
  aliases?: AliasObj[] | string[];
}

interface BulkEnvelope {
  status?: string;
  data?: BulkEntry[];
}

function extractAliasNames(
  raw: AliasObj[] | string[] | undefined | null,
): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.length > 0) out.push(item);
    } else if (
      item &&
      typeof item === "object" &&
      typeof item.name === "string" &&
      item.name.length > 0
    ) {
      out.push(item.name);
    }
  }
  return out.length > 0 ? out : null;
}

function buildPayload(
  externalId: string,
  germanTitle: string | null,
  aliases: string[] | null,
): TitlePayload | null {
  if (!germanTitle && (!aliases || aliases.length === 0)) return null;
  const titlesByLang: Record<string, string> = {};
  if (germanTitle) titlesByLang["de"] = germanTitle;
  const aliasesByLang =
    aliases && aliases.length > 0 ? { de: aliases } : undefined;
  return makeTitlePayload({ titlesByLang, aliasesByLang, externalId });
}

// pcjones currently exposes only the TV endpoint (`tvshow_german.php`); the
// provider returns null for `movie`, which falls through to TmdbProvider.
//
// Language output: pcjones only delivers German, so the provider only fills
// `titlesByLang.de` and `aliasesByLang.de`. Composite supplements missing
// languages via TMDB.
export class PcjonesApiProvider implements TitleProvider {
  readonly name = "pcjones-api";
  private readonly limiter = new HostRateLimiter(1000);
  private readonly log: Logger | null;

  constructor(private readonly opts: PcjonesApiOptions) {
    this.log =
      opts.logger?.child({ provider: "pcjones-api", host: opts.host }) ?? null;
  }

  supportedLanguages(): readonly string[] {
    return ["de"];
  }

  async fetchByExternalId(
    type: MediaType,
    externalId: string,
    _langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    if (type !== "tv") return null;
    const url = `${this.opts.host}/tvshow_german.php?tvdbid=${encodeURIComponent(externalId)}`;
    const { statusCode, json, durationMs, bytes } = await this.send("GET", url);
    if (statusCode >= 400) {
      this.log?.warn(
        { externalId, statusCode, durationMs: Math.round(durationMs), bytes },
        "pcjones lookup returned HTTP error",
      );
      return null;
    }
    const data = json as SingleEntry | null;
    if (!data || data.status !== "success") {
      this.log?.debug(
        { externalId, status: data?.status ?? "(none)" },
        "pcjones lookup empty or non-success",
      );
      return null;
    }
    const germanTitle = data.germanTitle ?? null;
    const aliases = extractAliasNames(data.aliases);
    const payload = buildPayload(externalId, germanTitle, aliases);
    this.log?.debug(
      {
        externalId,
        statusCode,
        durationMs: Math.round(durationMs),
        germanTitle,
        originalTitle: data.originalTitle ?? null,
        aliasesCount: aliases?.length ?? 0,
      },
      "pcjones single lookup",
    );
    return payload;
  }

  async fetchByTitle(
    type: MediaType,
    title: string,
    _langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    if (type !== "tv") return null;
    const url = `${this.opts.host}/tvshow_german.php?title=${encodeURIComponent(title)}`;
    const { statusCode, json, durationMs } = await this.send("GET", url);
    if (statusCode >= 400) {
      this.log?.warn(
        { title, statusCode, durationMs: Math.round(durationMs) },
        "pcjones title lookup returned HTTP error",
      );
      return null;
    }
    const data = json as SingleEntry | null;
    if (!data || data.status !== "success" || !data.germanTitle) return null;
    const externalId = data.tvdbId != null ? String(data.tvdbId) : "";
    return buildPayload(
      externalId,
      data.germanTitle ?? null,
      extractAliasNames(data.aliases),
    );
  }

  async fetchBulk(
    type: MediaType,
    externalIds: string[],
    _langs?: readonly string[],
    opts?: BulkFetchOptions,
  ): Promise<Map<string, TitlePayload>> {
    const out = new Map<string, TitlePayload>();
    if (type !== "tv" || externalIds.length === 0) return out;

    // Chunked to dodge an undocumented server-side length limit (silently
    // truncates the response otherwise) and to keep per-chunk logs readable.
    const CHUNK_SIZE = 50;
    const chunks: string[][] = [];
    for (let i = 0; i < externalIds.length; i += CHUNK_SIZE) {
      chunks.push(externalIds.slice(i, i + CHUNK_SIZE));
    }

    let totalGerman = 0;
    let totalAliasesOnly = 0;
    let totalEmpty = 0;
    let totalReturned = 0;

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx += 1) {
      const chunk = chunks[chunkIdx]!;
      const result = await this.fetchBulkChunk(
        chunk,
        chunkIdx + 1,
        chunks.length,
      );
      for (const [id, p] of result.payloads) {
        out.set(id, p);
        // Stream per-id result so callers can persist immediately. We fire
        // once per chunk completion (not per item) since pcjones returns the
        // chunk as a single response, so all entries are resolved together.
        if (opts?.onItem) {
          try {
            await opts.onItem(id, p);
          } catch (err) {
            this.log?.warn(
              { externalId: id, err },
              "pcjones bulk onItem callback failed",
            );
          }
        }
      }
      totalGerman += result.withGermanTitle;
      totalAliasesOnly += result.withAliasesOnly;
      totalEmpty += result.empty;
      totalReturned += result.returned;
    }

    this.log?.info(
      {
        requested: externalIds.length,
        returned: totalReturned,
        chunks: chunks.length,
        chunkSize: CHUNK_SIZE,
        withGermanTitle: totalGerman,
        withAliasesOnly: totalAliasesOnly,
        emptyHits: totalEmpty,
      },
      "pcjones bulk done",
    );

    if (totalGerman === 0 && externalIds.length > 0) {
      this.log?.warn(
        {
          requested: externalIds.length,
          returned: totalReturned,
          sample: externalIds.slice(0, 5),
        },
        "pcjones bulk returned 0 German titles — check host and endpoint",
      );
    }

    return out;
  }

  private async send(
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
  ): Promise<{
    statusCode: number;
    json: unknown;
    durationMs: number;
    bytes: number;
  }> {
    const host = new URL(url).host;
    await this.limiter.wait(host);
    const started = process.hrtime.bigint();
    try {
      const res = await request(url, {
        method,
        headers: {
          "User-Agent": this.opts.userAgent,
          ...(payload !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        bodyTimeout: 30_000,
        headersTimeout: 30_000,
      });
      // Read as text first so we can log a body preview if JSON parsing fails
      // (host returning an HTML error page is the common case).
      const text = await res.body.text();
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const bytes = text.length;
      let json: unknown = null;
      try {
        json = text.length > 0 ? JSON.parse(text) : null;
      } catch (parseErr) {
        this.log?.warn(
          {
            method,
            url,
            statusCode: res.statusCode,
            durationMs: Math.round(durationMs),
            bytes,
            bodyPreview: text.slice(0, 200),
            err: parseErr,
          },
          "pcjones response is not valid JSON",
        );
        return { statusCode: res.statusCode, json: null, durationMs, bytes };
      }
      return { statusCode: res.statusCode, json, durationMs, bytes };
    } catch (err) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.log?.error(
        { method, url, durationMs: Math.round(durationMs), err },
        "pcjones request failed (network/timeout)",
      );
      // Return an empty result instead of rethrowing so a single network
      // failure is treated like an empty lookup — consistent with TMDB/TVDB,
      // which return null/empty rather than aborting the chain. statusCode 0
      // is below the >=400 threshold callers check, and json:null is already
      // handled by every caller's empty-response branch.
      return { statusCode: 0, json: null, durationMs, bytes: 0 };
    }
  }

  private async fetchBulkChunk(
    chunk: string[],
    chunkIdx: number,
    chunkCount: number,
  ): Promise<{
    payloads: Map<string, TitlePayload>;
    returned: number;
    withGermanTitle: number;
    withAliasesOnly: number;
    empty: number;
  }> {
    const out = new Map<string, TitlePayload>();
    const url = `${this.opts.host}/tvshow_german.php?bulk=true`;
    this.log?.debug(
      { chunkIdx, chunkCount, count: chunk.length, sample: chunk.slice(0, 3) },
      "pcjones bulk chunk request",
    );

    const { statusCode, json, durationMs, bytes } = await this.send(
      "POST",
      url,
      {
        tvdbIds: chunk,
      },
    );

    if (statusCode >= 400) {
      this.log?.warn(
        {
          chunkIdx,
          chunkCount,
          count: chunk.length,
          statusCode,
          durationMs: Math.round(durationMs),
          bytes,
        },
        "pcjones bulk chunk returned HTTP error",
      );
      return {
        payloads: out,
        returned: 0,
        withGermanTitle: 0,
        withAliasesOnly: 0,
        empty: 0,
      };
    }

    const envelope = json as BulkEnvelope | null;
    if (
      !envelope ||
      typeof envelope !== "object" ||
      envelope.status !== "success"
    ) {
      this.log?.warn(
        {
          chunkIdx,
          chunkCount,
          count: chunk.length,
          statusCode,
          durationMs: Math.round(durationMs),
          bytes,
          status: envelope?.status ?? "(none)",
          bodyPreview:
            typeof json === "object" && json !== null
              ? JSON.stringify(json).slice(0, 200)
              : String(json).slice(0, 200),
        },
        "pcjones bulk response: expected { status: 'success', data: [...] }",
      );
      return {
        payloads: out,
        returned: 0,
        withGermanTitle: 0,
        withAliasesOnly: 0,
        empty: 0,
      };
    }

    const data = Array.isArray(envelope.data) ? envelope.data : [];
    let withGermanTitle = 0;
    let withAliasesOnly = 0;
    let empty = 0;
    for (const entry of data) {
      const id = entry.tvdbId != null ? String(entry.tvdbId) : null;
      if (!id) continue;
      const germanTitle = entry.germanTitle ?? null;
      const aliases = extractAliasNames(entry.aliases);
      const payload = buildPayload(id, germanTitle, aliases);
      if (payload) {
        out.set(id, payload);
        if (germanTitle) withGermanTitle += 1;
        else if (aliases && aliases.length > 0) withAliasesOnly += 1;
        else empty += 1;
      } else {
        empty += 1;
      }
    }

    const returned = out.size;
    const dropRate = (chunk.length - returned) / chunk.length;
    this.log?.info(
      {
        chunkIdx,
        chunkCount,
        requested: chunk.length,
        returned,
        withGermanTitle,
        withAliasesOnly,
        emptyHits: empty,
        durationMs: Math.round(durationMs),
        bytes,
        dropRate: Math.round(dropRate * 100) / 100,
      },
      "pcjones bulk chunk done",
    );

    return { payloads: out, returned, withGermanTitle, withAliasesOnly, empty };
  }
}
