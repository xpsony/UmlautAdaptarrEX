import { LRUCache } from "lru-cache";
import type { Logger } from "pino";
import { prisma } from "@/lib/db";
import { loadSetting, type SettingRow } from "@/lib/setting-helpers";
import { CompositeTitleProvider, DbCachedTitleProvider, looksLikeTmdbV4Token } from "@/providers";
import type { TitleProvider } from "@/providers/types";
import type { MediaType } from "@/domain/variations/generate";
import type { RewriteSearchItem } from "@/domain/xml/rewrite";
import type { ProviderId } from "@/schemas/instance";
import { OperationModeSchema, type OperationMode } from "@/schemas/settings";
import {
  normalizeForComparison,
  normalizedCharContribution,
} from "@/domain/normalization/comparison";
import { getCleanTitle } from "@/domain/normalization/clean";
import {
  aggregatePlugins,
  BUILTIN_PLUGINS,
  type LanguagePack,
  setActiveLanguagePack,
} from "@/domain/plugins";
import { loadActivePlugins, seedPlugins } from "@/server/plugins/seed";
import { resolveProxyPortEnv } from "@/lib/ports";

const RELEASE_YEAR_RE = /(?<![A-Za-z0-9])(19|20)\d{2}(?![A-Za-z0-9])/g;

function extractReleaseYears(title: string): number[] {
  const out: number[] = [];
  for (const m of title.matchAll(RELEASE_YEAR_RE)) out.push(Number(m[0]));
  return out;
}

export interface InstanceMatchOptions {
  enableYearMatching: boolean;
  yearMatchingTolerance: number;
}

const DEFAULT_INSTANCE_OPTIONS: InstanceMatchOptions = {
  enableYearMatching: true,
  yearMatchingTolerance: 1,
};

// Walks the original string and returns the index after enough characters
// have been consumed to cover `targetCount` normalized chars. Mirrors the
// walk used in src/domain/matching/rename.ts so findByTitle can apply the
// same token-boundary check.
function mapNormalizedLengthToOriginal(
  original: string,
  targetCount: number,
  pack: LanguagePack,
): number {
  let matched = 0;
  for (let i = 0; i < original.length; i++) {
    matched += normalizedCharContribution(original[i]!, pack);
    if (matched >= targetCount) return i + 1;
  }
  return original.length;
}

export interface CachedSearchItem {
  id: string;
  arrInstanceId: string;
  arrId: number;
  externalId: string;
  title: string;
  expectedTitle: string;
  expectedAuthor: string | null;
  germanTitle: string | null;
  mediaType: MediaType;
  /** Release/first-air year used for year-mismatch rejection at lookup time. */
  year: number | null;
  titleSearchVariations: string[];
  titleMatchVariations: string[];
  authorMatchVariations: string[];
}

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
  userAgent: string;
  setupComplete: boolean;
  logRetentionDays: number;
  indexerRateLimitMs: number;
  indexerTimeoutSeconds: number;
  operationMode: OperationMode;
  blockPrivateInstanceHosts: boolean;
  pausedUntil: Date | null;
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
  userAgent: "UmlautAdaptarrEX/2.0",
  setupComplete: false,
  logRetentionDays: 3,
  indexerRateLimitMs: 500,
  indexerTimeoutSeconds: 60,
  operationMode: "proxy",
  blockPrivateInstanceHosts: false,
  pausedUntil: null,
};

// Central in-memory cache + settings snapshot.
//   - Indexer response cache (per-URL LRU)
//   - SearchItem lookup index (normalized title → CachedSearchItem)
//   - Settings snapshot, invalidated via `reloadSettings()`
//   - TitleProvider rebuilt on settings update
export class AppState {
  readonly indexerCache: LRUCache<string, { body: Buffer; contentType: string; status: number }>;
  private byExternalId = new Map<string, CachedSearchItem>(); // `${type}:${externalId}`
  private byTitlePrefix = new Map<string, CachedSearchItem[]>(); // `${type}:${prefix5}`
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
   * before allowing non-DE language plugins to issue outbound calls — we
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
    const wrapped = new DbCachedTitleProvider(composite);
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
        "tmdb v4 token detected — provider disabled until a v3 key is set",
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
      userAgent: row.userAgent,
      setupComplete: row.setupComplete,
      logRetentionDays: row.logRetentionDays,
      indexerRateLimitMs: row.indexerRateLimitMs,
      indexerTimeoutSeconds: row.indexerTimeoutSeconds,
      // Defensive parse: SQLite TEXT column without CHECK; an invalid value
      // falls back cleanly to the recommended default "proxy".
      operationMode: OperationModeSchema.catch("proxy").parse(row.operationMode),
      blockPrivateInstanceHosts: row.blockPrivateInstanceHosts,
      pausedUntil: row.pausedUntil,
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
      userAgent: row.userAgent,
    };
    this._providersByOrder.clear();
    // Default provider (for legacy paths without an instance context):
    // pcjones first, with TVDB + TMDB as fallback. Sync calls
    // providerForOrder(instance.order) for the instance-specific case.
    this._provider = this.providerForOrder(["pcjones", "tvdb", "tmdb"]);
  }

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
   * is unknown — keeps callers free of null-checks while preserving the
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

  async loadSearchItemsFromDb(): Promise<void> {
    this.byExternalId.clear();
    this.byTitlePrefix.clear();
    await this.loadInstanceOptions();
    const rows = await prisma.searchItem.findMany();
    for (const row of rows) {
      const item: CachedSearchItem = {
        id: row.id,
        arrInstanceId: row.arrInstanceId,
        arrId: row.arrId,
        externalId: row.externalId,
        title: row.title,
        expectedTitle: row.expectedTitle,
        expectedAuthor: row.expectedAuthor,
        germanTitle: row.germanTitle,
        mediaType: row.mediaType as MediaType,
        year: row.year,
        titleSearchVariations: JSON.parse(row.titleSearchVariations) as string[],
        titleMatchVariations: JSON.parse(row.titleMatchVariations) as string[],
        authorMatchVariations: JSON.parse(row.authorMatchVariations) as string[],
      };
      this.indexItem(item);
    }
  }

  indexItem(item: CachedSearchItem): void {
    this.byExternalId.set(`${item.mediaType}:${item.externalId}`, item);
    for (const variation of item.titleMatchVariations) {
      const norm = normalizeForComparison(variation, this._languagePack);
      const prefix = `${item.mediaType}:${norm.slice(0, 5)}`;
      let bucket = this.byTitlePrefix.get(prefix);
      if (!bucket) {
        bucket = [];
        this.byTitlePrefix.set(prefix, bucket);
      }
      if (!bucket.includes(item)) bucket.push(item);
    }
  }

  removeItemsForInstance(instanceId: string): void {
    for (const [key, item] of this.byExternalId) {
      if (item.arrInstanceId === instanceId) this.byExternalId.delete(key);
    }
    for (const [prefix, bucket] of this.byTitlePrefix) {
      const filtered = bucket.filter((it) => it.arrInstanceId !== instanceId);
      if (filtered.length !== bucket.length) {
        this.byTitlePrefix.set(prefix, filtered);
      }
    }
  }

  getByExternalId(type: MediaType, externalId: string): CachedSearchItem | null {
    return this.byExternalId.get(`${type}:${externalId}`) ?? null;
  }

  // Returns true when the item's release year is compatible with the years
  // mentioned in the release title (or when the gate doesn't apply). The
  // gate only kicks in when the candidate item has a known year AND the
  // release names at least one year AND the instance has year-matching on.
  private passesYearGate(item: CachedSearchItem, releaseYears: number[]): boolean {
    if (item.year == null || releaseYears.length === 0) return true;
    const opts = this.getInstanceOptions(item.arrInstanceId);
    if (!opts.enableYearMatching) return true;
    const itemYear = item.year;
    const tol = opts.yearMatchingTolerance;
    return releaseYears.some((y) => Math.abs(y - itemYear) <= tol);
  }

  // Length of the longest match contributed by this item's variations,
  // strictly greater than `minLen`, or 0 when none qualifies. Mirrors the
  // boundary check in renameForMoviesAndTv so e.g. "Mike Renko 2" doesn't
  // spuriously prefix-match "Mike Renko 2016".
  private bestVariationMatchLen(
    item: CachedSearchItem,
    cleanTitle: string,
    norm: string,
    pack: LanguagePack,
    minLen: number,
  ): number {
    let bestLen = 0;
    for (const variation of item.titleMatchVariations) {
      const variationNorm = normalizeForComparison(variation, pack);
      if (variationNorm.length === 0) continue;
      if (variationNorm.length <= minLen) continue;
      if (variationNorm.length <= bestLen) continue;
      if (!norm.startsWith(variationNorm)) continue;
      const endIdx = mapNormalizedLengthToOriginal(cleanTitle, variationNorm.length, pack);
      const nextChar = cleanTitle[endIdx];
      if (nextChar !== undefined && /[A-Za-z0-9]/.test(nextChar)) continue;
      bestLen = variationNorm.length;
    }
    return bestLen;
  }

  findByTitle(type: MediaType, releaseTitle: string): CachedSearchItem | null {
    const pack = this._languagePack;
    const cleanTitle = getCleanTitle(releaseTitle, pack);
    const norm = normalizeForComparison(cleanTitle, pack);
    const prefix = `${type}:${norm.slice(0, 5)}`;
    const bucket = this.byTitlePrefix.get(prefix);
    if (!bucket) return null;

    // Year tokens in the original (un-normalized) release title.
    // Disambiguates franchise overlap (e.g. a Formula-1 race recording
    // many years off vs. the 2025 "F1 - Der Film"); operators can disable
    // year-matching per instance if their library years are unreliable.
    const releaseYears = extractReleaseYears(releaseTitle);

    let best: CachedSearchItem | null = null;
    let bestLen = 0;
    for (const item of bucket) {
      if (!this.passesYearGate(item, releaseYears)) continue;
      const matchLen = this.bestVariationMatchLen(item, cleanTitle, norm, pack, bestLen);
      if (matchLen > bestLen) {
        bestLen = matchLen;
        best = item;
      }
    }
    return best;
  }

  toRewriteSearchItem(item: CachedSearchItem): RewriteSearchItem {
    const opts = this.getInstanceOptions(item.arrInstanceId);
    return {
      expectedTitle: item.expectedTitle,
      expectedAuthor: item.expectedAuthor,
      titleMatchVariations: item.titleMatchVariations,
      authorMatchVariations: item.authorMatchVariations,
      mediaType: item.mediaType,
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
