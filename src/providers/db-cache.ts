import { prisma } from "@/lib/db";
import type { MediaType } from "@/domain/variations/generate";
import { makeTitlePayload, type TitlePayload, type TitleProvider } from "./types";

/**
 * TitleProvider decorator that persists responses in `TitleApiCache` (parent,
 * keyed by `${mediaType}:${externalId}`) and `TitleTranslation` (1:n by lang).
 *
 *   - Positive hits live until the user clears the cache via the UI.
 *   - Negative hits get a TTL (default 7 days) on the parent row so a
 *     temporarily broken provider does not get persisted as "not found"
 *     forever.
 *
 * `fetchByTitle` is not cached — the cache targets bulk sync lookups by id.
 */
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(type: MediaType, externalId: string): string {
  return `${type}:${externalId}`;
}

function parseAliasesJson(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

interface CachedRow {
  id: string;
  expiresAt: Date | null;
  translations: {
    lang: string;
    title: string | null;
    aliasesJson: string | null;
  }[];
}

function isFresh(row: CachedRow, now: Date): boolean {
  if (row.expiresAt === null) return true;
  return row.expiresAt > now;
}

function rowToPayload(row: CachedRow, externalId: string): TitlePayload {
  const titlesByLang: Record<string, string> = {};
  const aliasesByLang: Record<string, string[]> = {};
  for (const t of row.translations) {
    if (t.title) titlesByLang[t.lang] = t.title;
    const list = parseAliasesJson(t.aliasesJson);
    if (list && list.length > 0) aliasesByLang[t.lang] = list;
  }
  return makeTitlePayload({
    titlesByLang,
    aliasesByLang: Object.keys(aliasesByLang).length > 0 ? aliasesByLang : undefined,
    externalId,
  });
}

function coversAllLangs(row: CachedRow, langs: readonly string[] | undefined): boolean {
  if (!langs || langs.length === 0 || langs.includes("*")) {
    // No specific languages requested → fresh row is automatically OK.
    return true;
  }
  const haveByLang = new Set<string>();
  for (const t of row.translations) {
    haveByLang.add(t.lang); // including explicit negative entries (title=null)
  }
  return langs.every((l) => haveByLang.has(l));
}

/**
 * Structural subset of a logger's `error` method — matches pino's `Logger`
 * (and any test double) without importing pino into a provider module.
 */
export interface DbCacheErrorLogger {
  error: (obj: unknown, msg?: string) => void;
}

export class DbCachedTitleProvider implements TitleProvider {
  readonly name: string;

  constructor(
    private readonly inner: TitleProvider,
    private readonly logger?: DbCacheErrorLogger,
  ) {
    this.name = `db-cached(${inner.name})`;
  }

  supportedLanguages(): readonly string[] {
    return this.inner.supportedLanguages();
  }

  async fetchByExternalId(
    type: MediaType,
    externalId: string,
    langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    const id = cacheKey(type, externalId);
    const cached = await prisma.titleApiCache.findUnique({
      where: { id },
      include: {
        translations: {
          select: { lang: true, title: true, aliasesJson: true },
        },
      },
    });
    const now = new Date();
    if (cached && isFresh(cached, now) && coversAllLangs(cached, langs)) {
      return rowToPayload(cached, externalId);
    }
    const fresh = await this.inner.fetchByExternalId(type, externalId, langs);
    await this.persist(id, fresh, langs);
    return fresh;
  }

  async fetchByTitle(
    type: MediaType,
    title: string,
    langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    return this.inner.fetchByTitle(type, title, langs);
  }

  async fetchBulk(
    type: MediaType,
    externalIds: string[],
    langs?: readonly string[],
  ): Promise<Map<string, TitlePayload>> {
    const out = new Map<string, TitlePayload>();
    if (externalIds.length === 0) return out;

    const ids = externalIds.map((eid) => cacheKey(type, eid));
    const rows = await prisma.titleApiCache.findMany({
      where: { id: { in: ids } },
      include: {
        translations: {
          select: { lang: true, title: true, aliasesJson: true },
        },
      },
    });
    const now = new Date();
    const freshById = new Map<string, CachedRow>();
    for (const row of rows) {
      if (isFresh(row, now)) freshById.set(row.id, row);
    }

    const missing: string[] = [];
    for (const externalId of externalIds) {
      const id = cacheKey(type, externalId);
      const hit = freshById.get(id);
      if (hit && coversAllLangs(hit, langs)) {
        const payload = rowToPayload(hit, externalId);
        if (Object.keys(payload.titlesByLang).length > 0) {
          out.set(externalId, payload);
        }
        // Negative hits (no titles in any requested lang) are kept out of the
        // result map — match legacy behavior.
      } else {
        missing.push(externalId);
      }
    }

    if (missing.length === 0) return out;

    // Stream per-id persistence: each time the inner chain resolves an id, we
    // write it to the cache immediately. This way a crash mid-sync (TMDB
    // sequential calls, pcjones chunks, TVDB sequential) does not discard the
    // items already fetched — re-running the sync picks up where it left off.
    const persisted = new Set<string>();
    const onItem = async (externalId: string, payload: TitlePayload): Promise<void> => {
      await this.persist(cacheKey(type, externalId), payload, langs);
      persisted.add(externalId);
    };

    const fromInner = await this.inner.fetchBulk(type, missing, langs, {
      onItem,
    });
    for (const externalId of missing) {
      const payload = fromInner.get(externalId) ?? null;
      // Skip ids the streaming callback already persisted — its last call
      // carried the cumulative merged payload, which matches what the result
      // map holds. Only ids that the inner chain never resolved still need a
      // write here, to land a negative-cache row with a TTL.
      if (!persisted.has(externalId)) {
        await this.persist(cacheKey(type, externalId), payload, langs);
      }
      if (payload && Object.keys(payload.titlesByLang).length > 0) {
        out.set(externalId, payload);
      }
    }
    return out;
  }

  private async persist(
    id: string,
    payload: TitlePayload | null,
    requestedLangs: readonly string[] | undefined,
  ): Promise<void> {
    const titlesByLang = payload?.titlesByLang ?? {};
    const aliasesByLang = payload?.aliasesByLang ?? {};
    const isPositive =
      Object.keys(titlesByLang).length > 0 || Object.keys(aliasesByLang).length > 0;
    const parentData = {
      fetchedAt: new Date(),
      expiresAt: isPositive ? null : new Date(Date.now() + NEGATIVE_TTL_MS),
    };
    // Persist one TitleTranslation row per language we either *got* or
    // *requested but didn't get* — the latter is a per-lang negative cache
    // entry (title = null), so the next call skips the outbound roundtrip.
    const allLangs = new Set<string>([...Object.keys(titlesByLang), ...Object.keys(aliasesByLang)]);
    if (requestedLangs && !requestedLangs.includes("*")) {
      for (const l of requestedLangs) allLangs.add(l);
    }
    try {
      // Build the parent upsert + all translation upserts as one array and
      // run them in a single transaction, instead of 1+n sequential
      // round-trips. Same where/create/update payloads as before.
      const ops = [
        prisma.titleApiCache.upsert({
          where: { id },
          create: { id, ...parentData },
          update: parentData,
        }),
        ...Array.from(allLangs, (lang) => {
          const title = titlesByLang[lang] ?? null;
          const aliases = aliasesByLang[lang];
          const translationData = {
            title,
            aliasesJson: aliases && aliases.length > 0 ? JSON.stringify(aliases) : null,
          };
          return prisma.titleTranslation.upsert({
            where: { cacheId_lang: { cacheId: id, lang } },
            create: { cacheId: id, lang, ...translationData },
            update: translationData,
          });
        }),
      ];
      await prisma.$transaction(ops);
    } catch (err) {
      // Swallow: a failing title cache write must never abort the surrounding
      // sync. Prefer the injected structural logger (threaded from AppState
      // so failures land in the same pino pipeline); fall back to
      // console.error when no logger was provided.
      if (this.logger) {
        this.logger.error({ id, err }, "db-cache: titleApiCache upsert failed");
      } else {
        console.error("[db-cache] titleApiCache upsert failed", { id, err });
      }
    }
  }
}
