import type { Logger } from "pino";
import type { MediaType } from "@/domain/variations/generate";
import type { LanguagePack } from "@/domain/plugins";
import type { ProviderId } from "@/schemas/instance";
import {
  recordPcjonesHits,
  recordTmdbHits,
  recordTvdbHits,
} from "@/server/sync/stats";
import { PcjonesApiProvider } from "./pcjones-api";
import { looksLikeTmdbV4Token, TmdbProvider } from "./tmdb";
import { TvdbProvider } from "./tvdb";
import {
  makeTitlePayload,
  mergePayloads,
  type BulkFetchOptions,
  type TitlePayload,
  type TitleProvider,
} from "./types";

export { DbCachedTitleProvider } from "./db-cache";
export { looksLikeTmdbV4Token } from "./tmdb";

interface BuildProviderOptions {
  titleApiHost: string;
  tmdbApiKey: string | null | undefined;
  tvdbApiKey: string | null | undefined;
  tvdbPin?: string | null | undefined;
  userAgent: string;
  logger?: Logger | undefined;
  /**
   * User-defined order in which providers are queried per language tier.
   * Providers that are not configured are skipped at runtime.
   */
  providerOrder: readonly ProviderId[];
}

/** Default order for Sonarr (TV) when no explicit value is passed. */
const DEFAULT_ORDER: readonly ProviderId[] = ["pcjones", "tvdb", "tmdb"];

/**
 * Languages Composite should query for. Derived from the active LanguagePack:
 * the `language` field of each enabled plugin, deduplicated. With no plugin
 * active, Composite falls back to `["de"]`, matching the 1.x default.
 */
export function requiredLanguages(pack: LanguagePack): string[] {
  const set = new Set<string>();
  for (const p of pack.activePlugins) set.add(p.language);
  if (set.size === 0) set.add("de");
  return Array.from(set);
}

/**
 * For each language we walk the user order. pcjones is DE-only and gets
 * skipped for non-DE languages; TVDB and TMDB can both deliver every
 * language, and their ordering is dictated by the user order.
 */
export class CompositeTitleProvider implements TitleProvider {
  readonly name: string;
  private readonly order: readonly ProviderId[];
  private readonly pcjones: PcjonesApiProvider;
  private readonly tmdb: TmdbProvider | null;
  private readonly tvdb: TvdbProvider | null;
  private readonly log: Logger | null;

  constructor(opts: BuildProviderOptions) {
    this.order =
      opts.providerOrder.length > 0 ? opts.providerOrder : DEFAULT_ORDER;
    this.name = `composite(${this.order.join(",")})`;
    this.pcjones = new PcjonesApiProvider({
      host: opts.titleApiHost,
      userAgent: opts.userAgent,
      logger: opts.logger,
    });
    this.log = opts.logger?.child({ provider: this.name }) ?? null;
    if (opts.tmdbApiKey && !looksLikeTmdbV4Token(opts.tmdbApiKey)) {
      try {
        this.tmdb = new TmdbProvider({
          apiKey: opts.tmdbApiKey,
          userAgent: opts.userAgent,
          logger: opts.logger,
        });
      } catch (err) {
        this.log?.warn(
          { err },
          "tmdb provider rejected the configured key — running without TMDB",
        );
        this.tmdb = null;
      }
    } else {
      this.tmdb = null;
    }
    if (opts.tvdbApiKey && opts.tvdbApiKey.trim().length > 0) {
      try {
        this.tvdb = new TvdbProvider({
          apiKey: opts.tvdbApiKey,
          pin: opts.tvdbPin ?? null,
          userAgent: opts.userAgent,
          logger: opts.logger,
        });
      } catch (err) {
        this.log?.warn(
          { err },
          "tvdb provider failed to initialize — running without TVDB",
        );
        this.tvdb = null;
      }
    } else {
      this.tvdb = null;
    }
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
    const wantedLangs = langs && langs.length > 0 ? langs : ["de"];
    return this.fetchOne(type, externalId, wantedLangs);
  }

  async fetchByTitle(
    type: MediaType,
    title: string,
    langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    if (type !== "tv" && type !== "movie") return null;
    const wantedLangs = langs && langs.length > 0 ? langs : ["de"];
    let last: TitlePayload | null = null;
    for (const provider of this.orderedProvidersForLang("de")) {
      const r = await provider.fetchByTitle(type, title, wantedLangs);
      if (r) {
        last = mergePayloads(last, r);
        if (this.coversAll(last, wantedLangs)) return last;
      }
    }
    return last;
  }

  async fetchBulk(
    type: MediaType,
    ids: string[],
    langs?: readonly string[],
    opts?: BulkFetchOptions,
  ): Promise<Map<string, TitlePayload>> {
    const out = new Map<string, TitlePayload>();
    if (type !== "tv" && type !== "movie") return out;
    if (ids.length === 0) return out;

    const wantedLangs = langs && langs.length > 0 ? Array.from(langs) : ["de"];
    const merged = new Map<string, TitlePayload>();

    // For each provider in user order: bulk-fetch the languages that
    // provider can deliver and merge per id with the running state. Hits per
    // provider go into stats. Providers that can no longer contribute (every
    // wantedLang covered for every id) are skipped to save outbound calls.
    for (const id of this.order) {
      const provider = this.providerOf(id);
      if (!provider) continue;
      const langsForProvider = this.langsServedBy(id, wantedLangs);
      if (langsForProvider.length === 0) continue;
      const remainingIds = ids.filter((rid) => {
        const have = merged.get(rid);
        if (!have) return true;
        return langsForProvider.some((l) => !have.titlesByLang[l]);
      });
      if (remainingIds.length === 0) continue;

      // Wrap the upstream onItem so that each provider's per-id streaming
      // result is merged with prior provider contributions before being
      // forwarded. This way callers (DbCachedTitleProvider) see the cumulative
      // payload at every checkpoint, never a partial overwrite that would
      // drop a previously-resolved language.
      const wrappedOnItem: BulkFetchOptions["onItem"] | undefined = opts?.onItem
        ? async (rid, partial) => {
            const next =
              mergePayloads(merged.get(rid) ?? null, partial) ?? partial;
            merged.set(rid, next);
            await opts.onItem!(rid, next);
          }
        : undefined;

      let partial: Map<string, TitlePayload>;
      try {
        partial = await provider.fetchBulk(
          type,
          remainingIds,
          langsForProvider,
          wrappedOnItem ? { onItem: wrappedOnItem } : undefined,
        );
      } catch (err) {
        // Per-provider error isolation: a single failing provider must not
        // abort the whole chain or discard results already merged from earlier
        // providers. Log and move on to the next provider in user order.
        this.log?.warn(
          { provider: id, type, count: remainingIds.length, err },
          "provider fetchBulk failed — skipping provider",
        );
        continue;
      }
      for (const [rid, p] of partial) {
        // If the provider supports onItem, merged is already up-to-date for
        // every id it returned. Otherwise we merge here from the result map.
        if (!merged.has(rid) || merged.get(rid) !== p) {
          merged.set(rid, mergePayloads(merged.get(rid) ?? null, p) ?? p);
        }
      }
      this.recordHits(id, partial.size);
    }

    for (const id of ids) {
      const m = merged.get(id);
      if (!m) continue;
      out.set(
        id,
        makeTitlePayload({
          titlesByLang: m.titlesByLang,
          aliasesByLang: m.aliasesByLang,
          externalId: id,
        }),
      );
    }
    return out;
  }

  /**
   * Single-item path: sequential fallback chain, no bulk optimisations.
   * Sync uses `fetchBulk`; this entry point is exercised by tests.
   */
  private async fetchOne(
    type: "tv" | "movie",
    externalId: string,
    wantedLangs: readonly string[],
  ): Promise<TitlePayload | null> {
    let acc: TitlePayload | null = null;
    for (const id of this.order) {
      const provider = this.providerOf(id);
      if (!provider) continue;
      const langsForProvider = this.langsServedBy(id, wantedLangs);
      if (langsForProvider.length === 0) continue;
      const r = await provider.fetchByExternalId(
        type,
        externalId,
        langsForProvider,
      );
      if (r) {
        acc = mergePayloads(acc, r);
        if (this.coversAll(acc, wantedLangs)) return acc;
      }
    }
    return acc;
  }

  private coversAll(p: TitlePayload | null, langs: readonly string[]): boolean {
    if (!p) return false;
    return langs.every((l) => !!p.titlesByLang[l]);
  }

  /**
   * Returns the subset of `wantedLangs` that a given provider can deliver.
   * pcjones only handles DE; TMDB/TVDB handle every language.
   */
  private langsServedBy(
    id: ProviderId,
    wantedLangs: readonly string[],
  ): string[] {
    if (id === "pcjones") {
      return wantedLangs.includes("de") ? ["de"] : [];
    }
    return Array.from(wantedLangs);
  }

  private providerOf(id: ProviderId): TitleProvider | null {
    if (id === "pcjones") return this.pcjones;
    if (id === "tmdb") return this.tmdb;
    if (id === "tvdb") return this.tvdb;
    return null;
  }

  private recordHits(id: ProviderId, count: number): void {
    if (count <= 0) return;
    if (id === "pcjones") recordPcjonesHits(count);
    else if (id === "tmdb") recordTmdbHits(count);
    else if (id === "tvdb") recordTvdbHits(count);
  }

  private orderedProvidersForLang(lang: string): TitleProvider[] {
    const out: TitleProvider[] = [];
    for (const id of this.order) {
      if (id === "pcjones" && lang !== "de") continue;
      const p = this.providerOf(id);
      if (p) out.push(p);
    }
    return out;
  }
}
