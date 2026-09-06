import { LRUCache } from "lru-cache";
import type { Logger } from "pino";
import { prisma } from "@/lib/db";
import { loadSetting, type SettingRow } from "@/lib/setting-helpers";
import { CompositeTitleProvider, DbCachedTitleProvider, looksLikeTmdbV4Token } from "@/providers";
import type { TitleProvider } from "@/providers/types";
import type { MediaType } from "@/domain/variations/generate";
import type { RenameOptions } from "@/domain/matching/rename";
import type { RewriteSearchItem } from "@/domain/xml/rewrite";
import type { ProviderId } from "@/schemas/instance";
import { OperationModeSchema, type OperationMode } from "@/schemas/settings";
import {
  aggregatePlugins,
  BUILTIN_PLUGINS,
  type LanguagePack,
  setActiveLanguagePack,
} from "@/domain/plugins";
import { loadActivePlugins, seedPlugins } from "@/server/plugins/seed";
import { resolveProxyPortEnv } from "@/lib/ports";
import { defaultUserAgent, resolveUserAgent } from "@/lib/user-agent";
import {
  DEFAULT_INSTANCE_OPTIONS,
  SEARCH_ITEM_SELECT,
  toCachedSearchItem,
  type CachedSearchItem,
  type CachedSearchItemInput,
  type InstanceMatchOptions,
  type SearchItemRow,
} from "./search-item";
import { SearchItemIndex } from "./search-index";

export type {
  CachedSearchItem,
  CachedSearchItemInput,
  InstanceMatchOptions,
  SearchItemRow,
} from "./search-item";

// Ephemeral tier sizing. 500 items is far more than a burst of interactive
// searches produces, and 12h matches the indexer cache TTL - long enough that
// a re-search minutes later is free, short enough that a title the sync never
// picks up doesn't linger forever.
const EPHEMERAL_MAX = 500;
const EPHEMERAL_TTL_MS = 12 * 60 * 60 * 1000;

interface AppSettings {
  appApiKey: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword: string;
  cacheDurationMinutes: number;
  titleApiHost: string;
  tmdbApiKey: string | null;
  tvdbApiKey: string | null;
  tvdbPin: string | null;
  /**
   * The EFFECTIVE User-Agent for outbound requests - the operator's override
   * when set, otherwise `UmlautAdaptarrEX/<version>`. Resolved here so every
   * consumer gets a usable value without repeating the fallback.
   */
  userAgent: string;
  /** The raw override as stored (empty = automatic). */
  userAgentOverride: string;
  /** Forward the calling *Arr's User-Agent to the indexer instead of ours. */
  forwardArrUserAgent: boolean;
  setupComplete: boolean;
  logRetentionDays: number;
  historyRetentionDays: number;
  indexerRateLimitMs: number;
  indexerTimeoutSeconds: number;
  /** Quick-sync cadence in minutes; 0 disables the quick sync. */
  syncIntervalMinutes: number;
  /** Full-sync cadence in hours. */
  fullSyncIntervalHours: number;
  /** Resolve unknown titles during the request that asks for them. */
  onDemandLookup: boolean;
  /** Search with German title variations, per media type. */
  tvVariationSearch: boolean;
  movieVariationSearch: boolean;
  /** Cap on GERMAN variations per search; q and expectedTitle come on top. */
  maxTitleVariations: number;
  operationMode: OperationMode;
  blockPrivateInstanceHosts: boolean;
  pausedUntil: Date | null;
  // Renaming behaviour - see the Setting model for what each flag does.
  renameYearGuard: boolean;
  renamePrefixGuard: boolean;
  renameReleaseTagGuard: boolean;
  renameLegacySuffix: boolean;
  renameStripSpecialChars: boolean;
  renameAttachExternalIds: boolean;
}

const NO_SETTINGS: AppSettings = {
  appApiKey: "",
  proxyPort: 5006,
  proxyUsername: "UmlautAdaptarr",
  proxyPassword: "",
  cacheDurationMinutes: 12,
  titleApiHost: "https://umlautadaptarr.pcjones.de/api/v1",
  tmdbApiKey: null,
  tvdbApiKey: null,
  tvdbPin: null,
  userAgent: defaultUserAgent(),
  userAgentOverride: "",
  forwardArrUserAgent: false,
  setupComplete: false,
  logRetentionDays: 3,
  historyRetentionDays: 30,
  indexerRateLimitMs: 500,
  indexerTimeoutSeconds: 60,
  syncIntervalMinutes: 10,
  fullSyncIntervalHours: 24,
  onDemandLookup: true,
  tvVariationSearch: true,
  movieVariationSearch: true,
  maxTitleVariations: 1,
  operationMode: "proxy",
  blockPrivateInstanceHosts: false,
  pausedUntil: null,
  renameYearGuard: true,
  renamePrefixGuard: true,
  renameReleaseTagGuard: true,
  renameLegacySuffix: false,
  // Bare-install defaults, matching the Prisma column defaults. Existing
  // installations are pinned to `false` by the rename_options migration.
  renameStripSpecialChars: true,
  renameAttachExternalIds: true,
};

// Central in-memory cache + settings snapshot.
//   - Indexer response cache (per-URL LRU)
//   - SearchItem lookup index (normalized title → CachedSearchItem)
//   - Settings snapshot, invalidated via `reloadSettings()`
//   - TitleProvider rebuilt on settings update
export class AppState {
  readonly indexerCache: LRUCache<string, { body: Buffer; contentType: string; status: number }>;
  /** Items written by the sync. Sole owner: the sync path. */
  private readonly syncIndex = new SearchItemIndex();
  /**
   * Second lookup tier: items resolved on demand for a request whose title
   * the sync hasn't picked up yet. Held in its own index so the sync tier is
   * never polluted, and bounded by an LRU with a TTL.
   *
   * The LRU owns the lifetime; `ephemeralIndex` owns the lookup structures.
   * `dispose` keeps the two in step when an entry is evicted or expires.
   * `noDisposeOnSet` is required: without it, overwriting a key would dispose
   * the OLD value after `indexEphemeral` already re-indexed the new one under
   * the same key, silently removing the fresh entry.
   */
  private readonly ephemeralIndex = new SearchItemIndex();
  private readonly ephemeral: LRUCache<string, CachedSearchItem>;
  // Per-instance match options (year-matching toggle + tolerance). Loaded
  // alongside SearchItems so findByTitle / toRewriteSearchItem can apply
  // them without an extra DB hit per request.
  private _instanceOptions = new Map<string, InstanceMatchOptions>();
  // Memoises a DbCachedTitleProvider per order signature (e.g.
  // "pcjones,tvdb,tmdb"), wrapping the matching Composite. Capped at six
  // permutations, so the cache stays small.
  private _providersByOrder: Map<string, TitleProvider> = new Map();
  private _logger: Logger | null = null;

  constructor() {
    this.indexerCache = new LRUCache({
      max: 5000,
      ttl: 12 * 60 * 1000,
      ttlAutopurge: true,
    });
    this.ephemeral = new LRUCache({
      max: EPHEMERAL_MAX,
      ttl: EPHEMERAL_TTL_MS,
      ttlAutopurge: true,
      noDisposeOnSet: true,
      dispose: (item) => {
        this.ephemeralIndex.removeItem(item.mediaType, item.externalId);
      },
    });
  }

  private _settings: AppSettings = NO_SETTINGS;

  get settings(): AppSettings {
    return this._settings;
  }

  private _provider: TitleProvider | null = null;
  private _providerBuildOpts: {
    titleApiHost: string;
    tmdbApiKey: string | null;
    tvdbApiKey: string | null;
    tvdbPin: string | null;
    userAgent: string;
  } | null = null;

  get provider(): TitleProvider | null {
    return this._provider;
  }

  private _languagePack: LanguagePack = aggregatePlugins(
    BUILTIN_PLUGINS.filter((p) => p.defaultEnabled),
  );

  get languagePack(): LanguagePack {
    return this._languagePack;
  }

  private _tmdbAvailable = false;
  private _tvdbAvailable = false;

  /**
   * True only when a usable TMDB v3 API key is configured. Sync checks this
   * before allowing non-DE language plugins to issue outbound calls - we
   * never spam TMDB without an opt-in (and fail fast with a clear reason).
   */
  get tmdbAvailable(): boolean {
    return this._tmdbAvailable;
  }

  /** True when a TVDB v4 API key is configured. */
  get tvdbAvailable(): boolean {
    return this._tvdbAvailable;
  }

  // Must be called before `reloadSettings()` so providers receive the logger.
  setLogger(logger: Logger): void {
    this._logger = logger;
  }

  providerForOrder(order: readonly ProviderId[]): TitleProvider | null {
    if (!this._providerBuildOpts) return null;
    const key = order.join(",");
    const cached = this._providersByOrder.get(key);
    if (cached) return cached;
    const composite = new CompositeTitleProvider({
      titleApiHost: this._providerBuildOpts.titleApiHost,
      tmdbApiKey: this._providerBuildOpts.tmdbApiKey,
      tvdbApiKey: this._providerBuildOpts.tvdbApiKey,
      tvdbPin: this._providerBuildOpts.tvdbPin,
      userAgent: this._providerBuildOpts.userAgent,
      logger: this._logger ?? undefined,
      providerOrder: order,
    });
    const wrapped = new DbCachedTitleProvider(composite, this._logger ?? undefined);
    this._providersByOrder.set(key, wrapped);
    return wrapped;
  }

  // Resets settings + provider state to the bare-install defaults. Called
  // when the Setting row hasn't been created yet (first boot before the
  // setup wizard has written anything).
  private resetToDefaults(): void {
    this._settings = NO_SETTINGS;
    this._provider = null;
    this._providersByOrder.clear();
    this._providerBuildOpts = null;
    this._tmdbAvailable = false;
    this._tvdbAvailable = false;
  }

  // The env var UMLAUTADAPTARREX_PROXY_PORT wins over the persisted DB value at
  // every boot (it is treated as a bind port, like the Fastify/Web UI ports).
  // Applied centrally here so the proxy listener, the URL advertised to
  // Prowlarr, and the Settings UI all observe one effective value.
  private applyProxyPortEnvOverride(): void {
    const envPort = resolveProxyPortEnv();
    if (envPort !== null) {
      this._settings = { ...this._settings, proxyPort: envPort };
    }
  }

  // moviedb-promise (v4) supports only TMDB v3 API keys (32-char hex). Old
  // installs may still have a v4 Read Access Token (JWT 'eyJ…') saved in
  // Settings: refusing them up-front avoids loud per-request 401s.
  private resolveTmdbKey(rawTmdbKey: string | null): string | null {
    if (!rawTmdbKey) return null;
    if (looksLikeTmdbV4Token(rawTmdbKey)) {
      this._logger?.warn(
        {
          hint:
            "Configured TMDB key looks like a v4 Read Access Token (JWT 'eyJ…'). " +
            "moviedb-promise needs a v3 API key (32-char hex). Update it in Settings → TMDB.",
        },
        "tmdb v4 token detected - provider disabled until a v3 key is set",
      );
      return null;
    }
    return rawTmdbKey;
  }

  private toSettingsSnapshot(row: NonNullable<SettingRow>): AppSettings {
    return {
      appApiKey: row.appApiKey,
      proxyPort: row.proxyPort,
      proxyUsername: row.proxyUsername,
      proxyPassword: row.proxyPassword,
      cacheDurationMinutes: row.cacheDurationMinutes,
      titleApiHost: row.titleApiHost,
      tmdbApiKey: row.tmdbApiKey,
      tvdbApiKey: row.tvdbApiKey,
      tvdbPin: row.tvdbPin,
      userAgent: resolveUserAgent(row.userAgent),
      userAgentOverride: row.userAgent,
      forwardArrUserAgent: row.forwardArrUserAgent,
      setupComplete: row.setupComplete,
      logRetentionDays: row.logRetentionDays,
      historyRetentionDays: row.historyRetentionDays,
      indexerRateLimitMs: row.indexerRateLimitMs,
      indexerTimeoutSeconds: row.indexerTimeoutSeconds,
      syncIntervalMinutes: row.syncIntervalMinutes,
      fullSyncIntervalHours: row.fullSyncIntervalHours,
      onDemandLookup: row.onDemandLookup,
      tvVariationSearch: row.tvVariationSearch,
      movieVariationSearch: row.movieVariationSearch,
      maxTitleVariations: row.maxTitleVariations,
      // Defensive parse: SQLite TEXT column without CHECK; an invalid value
      // falls back cleanly to the recommended default "proxy".
      operationMode: OperationModeSchema.catch("proxy").parse(row.operationMode),
      blockPrivateInstanceHosts: row.blockPrivateInstanceHosts,
      pausedUntil: row.pausedUntil,
      renameYearGuard: row.renameYearGuard,
      renamePrefixGuard: row.renamePrefixGuard,
      renameReleaseTagGuard: row.renameReleaseTagGuard,
      renameLegacySuffix: row.renameLegacySuffix,
      renameStripSpecialChars: row.renameStripSpecialChars,
      renameAttachExternalIds: row.renameAttachExternalIds,
    };
  }

  /**
   * The rename behaviour flags in the shape the domain layer expects. Kept as
   * a getter so the legacy search path never has to know the column names.
   */
  get renameOptions(): RenameOptions {
    return {
      yearGuard: this._settings.renameYearGuard,
      prefixGuard: this._settings.renamePrefixGuard,
      releaseTagGuard: this._settings.renameReleaseTagGuard,
      legacySuffix: this._settings.renameLegacySuffix,
      stripSpecialChars: this._settings.renameStripSpecialChars,
    };
  }

  /**
   * True when the admin has temporarily paused title manipulation. While
   * paused, the legacy search path returns upstream indexer responses
   * unmodified and skips outbound umlaut-variation expansion.
   */
  isPausedNow(): boolean {
    const u = this._settings.pausedUntil;
    return u !== null && u.getTime() > Date.now();
  }

  async reloadSettings(): Promise<void> {
    await this.reloadPlugins();
    const row = await loadSetting();
    if (!row) {
      this.resetToDefaults();
      this.applyProxyPortEnvOverride();
      return;
    }
    const tmdbKeyForProvider = this.resolveTmdbKey(row.tmdbApiKey);
    this._tmdbAvailable = !!tmdbKeyForProvider && tmdbKeyForProvider.length > 0;
    this._tvdbAvailable = !!row.tvdbApiKey && row.tvdbApiKey.length > 0;
    this._settings = this.toSettingsSnapshot(row);
    this.applyProxyPortEnvOverride();
    // Composite builders are lazily cached per order signature in
    // `providerForOrder`; the reload only needs to rewire the singleton
    // clients, so we clear the cache map.
    this._providerBuildOpts = {
      titleApiHost: row.titleApiHost,
      tmdbApiKey: tmdbKeyForProvider,
      tvdbApiKey: row.tvdbApiKey,
      tvdbPin: row.tvdbPin,
      userAgent: resolveUserAgent(row.userAgent),
    };
    this._providersByOrder.clear();
    // Default provider (for legacy paths without an instance context):
    // pcjones first, with TVDB + TMDB as fallback. Sync calls
    // providerForOrder(instance.order) for the instance-specific case.
    this._provider = this.providerForOrder(["pcjones", "tvdb", "tmdb"]);
  }

  // Note: a pack change here leaves the existing index (byTitlePrefix
  // prefixes + each item's normalizedMatchVariations) normalized against the
  // *old* pack until a resync rebuilds it via indexItem - a known, bounded
  // staleness window surfaced to the admin by the UI's requiresResync banner.
  async reloadPlugins(): Promise<void> {
    await seedPlugins();
    const enabledIds = new Set(await loadActivePlugins());
    const active = BUILTIN_PLUGINS.filter((p) => enabledIds.has(p.id));
    this._languagePack = aggregatePlugins(active);
    setActiveLanguagePack(this._languagePack);
  }

  async loadInstanceOptions(): Promise<void> {
    this._instanceOptions.clear();
    const rows = await prisma.arrInstance.findMany({
      select: {
        id: true,
        enableYearMatching: true,
        yearMatchingTolerance: true,
      },
    });
    for (const row of rows) {
      this._instanceOptions.set(row.id, {
        enableYearMatching: row.enableYearMatching,
        yearMatchingTolerance: row.yearMatchingTolerance,
      });
    }
  }

  /**
   * Returns the matching options for an Arr instance. Falls back to the
   * permissive defaults (year-matching on, tolerance 1) when the instance
   * is unknown - keeps callers free of null-checks while preserving the
   * documented default behaviour.
   */
  getInstanceOptions(instanceId: string): InstanceMatchOptions {
    return this._instanceOptions.get(instanceId) ?? DEFAULT_INSTANCE_OPTIONS;
  }

  setInstanceOptions(instanceId: string, options: InstanceMatchOptions): void {
    this._instanceOptions.set(instanceId, options);
  }

  removeInstanceOptions(instanceId: string): void {
    this._instanceOptions.delete(instanceId);
  }

  // Converts + indexes a batch of raw SearchItem rows, skipping any row whose
  // JSON variation columns fail to parse (e.g. left truncated by an aborted
  // write) instead of failing the whole load/reindex. Shared by
  // loadSearchItemsFromDb and reindexInstance since both feed the same
  // toCachedSearchItem conversion. Keeps up to 3 error samples (row id +
  // message) so the single warn can distinguish a genuine data-corruption
  // case from a code bug in the conversion.
  private indexRowsSkippingCorrupt(rows: SearchItemRow[]): void {
    let skipped = 0;
    const samples: { rowId: string; error: string }[] = [];
    for (const row of rows) {
      try {
        this.indexItem(toCachedSearchItem(row));
      } catch (err) {
        skipped++;
        if (samples.length < 3) {
          samples.push({ rowId: row.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    if (skipped > 0) {
      this._logger?.warn(
        { skipped, total: rows.length, samples },
        "search-item index: skipped corrupt rows",
      );
    }
  }

  async loadSearchItemsFromDb(): Promise<void> {
    this.syncIndex.clear();
    await this.loadInstanceOptions();
    const rows = await prisma.searchItem.findMany({ select: SEARCH_ITEM_SELECT });
    this.indexRowsSkippingCorrupt(rows);
  }

  indexItem(item: CachedSearchItemInput): void {
    this.syncIndex.indexItem(item, this._languagePack);
  }

  removeItemsForInstance(instanceId: string): void {
    this.syncIndex.removeItemsForInstance(instanceId);
  }

  /** Targeted removal, for the delta sync's per-item reindex. */
  removeItem(mediaType: MediaType, externalId: string): void {
    this.syncIndex.removeItem(mediaType, externalId);
  }

  /**
   * Indexes an on-demand resolved item into the ephemeral tier. Returns the
   * indexed item (with `normalizedMatchVariations` filled in).
   */
  indexEphemeral(item: CachedSearchItemInput): CachedSearchItem {
    // indexItem is not idempotent per object identity, so a repeat resolution
    // of the same key has to clear the old buckets first.
    this.ephemeralIndex.removeItem(item.mediaType, item.externalId);
    const indexed = this.ephemeralIndex.indexItem({ ...item, ephemeral: true }, this._languagePack);
    this.ephemeral.set(`${indexed.mediaType}:${indexed.externalId}`, indexed);
    return indexed;
  }

  // The index has no TTL of its own, so a hit found through it has to be
  // confirmed against the LRU, which does.
  private isEphemeralLive(item: CachedSearchItem): boolean {
    return this.ephemeral.has(`${item.mediaType}:${item.externalId}`);
  }

  // Drop and re-read one instance's items - used by the title-override
  // rebuild so a saved override is searchable immediately, mirroring the
  // remove-then-index pattern of the sync's persistAndReindex.
  async reindexInstance(instanceId: string): Promise<void> {
    this.removeItemsForInstance(instanceId);
    const rows = await prisma.searchItem.findMany({
      where: { arrInstanceId: instanceId },
      select: SEARCH_ITEM_SELECT,
    });
    this.indexRowsSkippingCorrupt(rows);
  }

  getByExternalId(type: MediaType, externalId: string): CachedSearchItem | null {
    const synced = this.syncIndex.getByExternalId(type, externalId);
    if (synced) return synced;
    // Read through the LRU, not the index: only the LRU honours the TTL.
    return this.ephemeral.get(`${type}:${externalId}`) ?? null;
  }

  getByImdbId(imdbId: string): CachedSearchItem | null {
    const synced = this.syncIndex.getByImdbId(imdbId);
    if (synced) return synced;
    const hit = this.ephemeralIndex.getByImdbId(imdbId);
    return hit && this.isEphemeralLive(hit) ? hit : null;
  }

  findByTitle(type: MediaType, releaseTitle: string): CachedSearchItem | null {
    const resolveOptions = (id: string): InstanceMatchOptions => this.getInstanceOptions(id);
    const synced = this.syncIndex.findByTitle(
      type,
      releaseTitle,
      this._languagePack,
      resolveOptions,
    );
    if (synced) return synced;
    const hit = this.ephemeralIndex.findByTitle(
      type,
      releaseTitle,
      this._languagePack,
      resolveOptions,
    );
    return hit && this.isEphemeralLive(hit) ? hit : null;
  }

  toRewriteSearchItem(item: CachedSearchItem): RewriteSearchItem {
    const opts = this.getInstanceOptions(item.arrInstanceId);
    return {
      expectedTitle: item.expectedTitle,
      expectedAuthor: item.expectedAuthor,
      titleMatchVariations: item.titleMatchVariations,
      authorMatchVariations: item.authorMatchVariations,
      mediaType: item.mediaType,
      externalId: item.externalId,
      // Normalised to null so the rewrite item never carries `undefined`
      // (it is serialised into log lines and compared in tests).
      imdbId: item.imdbId ?? null,
      year: item.year,
      // null disables the year check at the matching layer; otherwise the
      // configured tolerance is forwarded as +/-N around `year`.
      yearMatchingTolerance: opts.enableYearMatching ? opts.yearMatchingTolerance : null,
    };
  }
}

let instance: AppState | null = null;

export function getAppState(): AppState {
  if (!instance) instance = new AppState();
  return instance;
}
