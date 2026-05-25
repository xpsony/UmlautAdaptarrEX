import { prisma } from "@/lib/db";
import { buildArrClient } from "@/arr";
import { isMaskedSecret } from "@/lib/secrets";
import type { ArrType, ProviderId } from "@/schemas/instance";
import type { AppLogger } from "@/server/logging/logger";
import { type AppState, type CachedSearchItem, getAppState } from "@/server/state";
import type { MediaType } from "@/domain/variations/generate";
import type { TitleProvider } from "@/providers/types";
import { requiredLanguages } from "@/providers";
import { withSyncStats } from "@/server/sync/stats";
import { describeError } from "@/lib/error-format";

export interface PreparedRun {
  /** SyncRun row pre-created by the scheduler (status="running"). */
  runId: string;
  instance: {
    id: string;
    name: string;
    type: string;
    host: string;
    apiKey: string;
    enabled: boolean;
    /** CSV provider order; NULL for lidarr/readarr (no provider needed). */
    providerOrder: string | null;
  };
}

export interface RunSyncOptions {
  logger: AppLogger;
  /** Runs prepared by the scheduler; required (sync no longer self-discovers instances). */
  preparedRuns: PreparedRun[];
}

type PerInstanceResult = {
  instanceId: string;
  runId: string;
  type: ArrType;
  name: string;
  count: number;
  error?: string;
};

export interface SyncResult {
  totalItems: number;
  perInstance: PerInstanceResult[];
}

interface ProviderStats {
  pcjonesItems: number;
  tmdbItems: number;
  tvdbItems: number;
}

const VALID_PROVIDERS: readonly ProviderId[] = ["pcjones", "tvdb", "tmdb"];

/**
 * Parses a provider order stored as CSV in the DB into a validated list.
 * Unknown tokens and duplicates are filtered out; empty or invalid input
 * returns `null` (sync falls back to its default path).
 */
function parseProviderOrder(csv: string | null): ProviderId[] | null {
  if (!csv) return null;
  const seen = new Set<ProviderId>();
  for (const part of csv.split(",")) {
    const id = part.trim() as ProviderId;
    if (VALID_PROVIDERS.includes(id) && !seen.has(id)) seen.add(id);
  }
  return seen.size > 0 ? Array.from(seen) : null;
}

// Mark a run failed and propagate the message to the instance row so the UI
// can surface it. Always returns a perInstance entry the caller can collect.
async function markRunFailed(
  prepared: PreparedRun,
  message: string,
  options: { updateInstance?: boolean } = {},
): Promise<PerInstanceResult> {
  const { instance, runId } = prepared;
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: "error",
      finishedAt: new Date(),
      errorMessage: message,
    },
  });
  if (options.updateInstance !== false) {
    await prisma.arrInstance.update({
      where: { id: instance.id },
      data: { lastSyncError: message },
    });
  }
  return {
    instanceId: instance.id,
    runId,
    type: instance.type as ArrType,
    name: instance.name,
    count: 0,
    error: message,
  };
}

/**
 * Marks all SyncRun rows still flagged as "running" as "cancelled". Called
 * once during server boot: a run can only be in "running" state if the
 * previous process crashed or was killed before it could transition the row
 * to "success" or "error", so on startup any leftover row is by definition
 * stale and must be closed out.
 */
export async function cancelStaleRuns(logger: AppLogger): Promise<number> {
  const result = await prisma.syncRun.updateMany({
    where: { status: "running" },
    data: {
      status: "cancelled",
      finishedAt: new Date(),
      errorMessage: "Aborted: server restart while sync was running",
    },
  });
  if (result.count > 0) {
    logger.warn({ count: result.count }, "marked stale running sync runs as cancelled on boot");
  }
  return result.count;
}

async function markRunSucceeded(
  prepared: PreparedRun,
  itemsCount: number,
  stats: ProviderStats,
): Promise<PerInstanceResult> {
  const { instance, runId } = prepared;
  await prisma.syncRun.update({
    where: { id: runId },
    data: {
      status: "success",
      finishedAt: new Date(),
      itemsCount,
      pcjonesItemsCount: stats.pcjonesItems,
      tmdbItemsCount: stats.tmdbItems,
      tvdbItemsCount: stats.tvdbItems,
    },
  });
  await prisma.arrInstance.update({
    where: { id: instance.id },
    data: { lastSyncAt: new Date(), lastSyncError: null },
  });
  return {
    instanceId: instance.id,
    runId,
    type: instance.type as ArrType,
    name: instance.name,
    count: itemsCount,
  };
}

// Pre-flight: refuse to spam TMDB when the user enabled non-DE language
// plugins but never configured a v3 API key. Returns the abort message if
// blocked, null if cleared.
function checkTmdbPreflight(state: AppState): string | null {
  const langs = requiredLanguages(state.languagePack);
  const nonDeLangs = langs.filter((l) => l !== "de");
  if (nonDeLangs.length === 0 || state.tmdbAvailable) return null;
  return (
    `Active language plugins require TMDB for ${nonDeLangs.join(", ")}, ` +
    `but no usable TMDB v3 API key is configured. Set one in Settings → ` +
    `Providers, or disable the non-German plugins.`
  );
}

interface PersistChangeStats {
  created: number;
  updated: number;
  removed: number;
  germanTitleChanged: number;
  expectedTitleChanged: number;
  /** Rows that survived dedup and were actually persisted. */
  persistedCount: number;
}

// Per-instance cap on per-item INFO logs to keep the log stream readable
// during a first sync of a large library (Radarr at 5k+ titles would otherwise
// emit thousands of "title synced" lines). Aggregate counts always log.
const PER_ITEM_LOG_CAP = 50;

// Batch size for upsert transactions in persistAndReindex. Splitting a large
// sync into many short transactions keeps the SQLite writer lock available
// for other concurrent instance syncs, instead of holding it for the entire
// 5k-item library at once. Small chunks also give the sync more save points:
// a mid-sync crash loses at most ~50 items of progress, not 200.
const PERSIST_CHUNK_SIZE = 50;

// Replaces the on-disk SearchItem rows for one instance with the freshly
// fetched items, then rebuilds the in-memory index from the new rows.
async function persistAndReindex(
  state: AppState,
  instanceId: string,
  instanceName: string,
  items: Awaited<ReturnType<ReturnType<typeof buildArrClient>["fetchAllItems"]>>,
  logger: AppLogger,
): Promise<PersistChangeStats> {
  const existing = await prisma.searchItem.findMany({
    where: { arrInstanceId: instanceId },
    select: {
      id: true,
      externalId: true,
      title: true,
      expectedTitle: true,
      germanTitle: true,
    },
  });
  const existingMap = new Map(existing.map((e) => [e.externalId, e]));
  const itemsByExternalId = new Map<string, (typeof items)[number]>();
  let droppedDuplicates = 0;
  for (const item of items) {
    if (itemsByExternalId.has(item.externalId)) {
      droppedDuplicates += 1;
      continue;
    }
    itemsByExternalId.set(item.externalId, item);
  }
  if (droppedDuplicates > 0) {
    logger.warn(
      { instance: instanceName, droppedDuplicates, total: items.length },
      "sync: dropped duplicate externalIds before persist",
    );
  }
  const deduped = Array.from(itemsByExternalId.values());
  const seenExternalIds = new Set<string>();
  const stats: PersistChangeStats = {
    created: 0,
    updated: 0,
    removed: 0,
    germanTitleChanged: 0,
    expectedTitleChanged: 0,
    persistedCount: deduped.length,
  };
  let perItemLogged = 0;
  const logChange = (event: Record<string, unknown>, msg: string): void => {
    if (perItemLogged >= PER_ITEM_LOG_CAP) return;
    perItemLogged += 1;
    logger.info({ instance: instanceName, ...event }, msg);
    if (perItemLogged === PER_ITEM_LOG_CAP) {
      logger.info(
        { instance: instanceName, cap: PER_ITEM_LOG_CAP },
        "sync: further per-item changes suppressed (cap reached); see summary",
      );
    }
  };

  for (let i = 0; i < deduped.length; i += PERSIST_CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + PERSIST_CHUNK_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const item of chunk) {
        seenExternalIds.add(item.externalId);
        const data = {
          arrInstanceId: instanceId,
          arrId: item.arrId,
          externalId: item.externalId,
          title: item.title,
          expectedTitle: item.expectedTitle,
          expectedAuthor: item.expectedAuthor ?? null,
          germanTitle: item.germanTitle ?? null,
          mediaType: item.mediaType,
          year: item.year ?? null,
          titleSearchVariations: JSON.stringify(item.titleSearchVariations),
          titleMatchVariations: JSON.stringify(item.titleMatchVariations),
          authorMatchVariations: JSON.stringify(item.authorMatchVariations),
          aliases: item.aliases ? JSON.stringify(item.aliases) : null,
        };
        const prior = existingMap.get(item.externalId);
        if (prior) {
          await tx.searchItem.update({ where: { id: prior.id }, data });
          stats.updated += 1;
          const germanChanged = (prior.germanTitle ?? null) !== (item.germanTitle ?? null);
          const expectedChanged = prior.expectedTitle !== item.expectedTitle;
          if (germanChanged) stats.germanTitleChanged += 1;
          if (expectedChanged) stats.expectedTitleChanged += 1;
          if (germanChanged || expectedChanged) {
            logChange(
              {
                event: "title-changed",
                mediaType: item.mediaType,
                externalId: item.externalId,
                title: item.title,
                previousGermanTitle: prior.germanTitle,
                germanTitle: item.germanTitle,
                previousExpectedTitle: prior.expectedTitle,
                expectedTitle: item.expectedTitle,
                year: item.year ?? null,
              },
              "sync: title updated",
            );
          }
        } else {
          await tx.searchItem.create({ data });
          stats.created += 1;
          logChange(
            {
              event: "title-added",
              mediaType: item.mediaType,
              externalId: item.externalId,
              title: item.title,
              expectedTitle: item.expectedTitle,
              germanTitle: item.germanTitle,
              year: item.year ?? null,
            },
            "sync: title added",
          );
        }
      }
    });
  }

  const stale = existing.filter((e) => !seenExternalIds.has(e.externalId));
  if (stale.length > 0) {
    stats.removed = stale.length;
    for (const s of stale) {
      logChange(
        {
          event: "title-removed",
          externalId: s.externalId,
          title: s.title,
        },
        "sync: title removed",
      );
    }
    await prisma.searchItem.deleteMany({
      where: { id: { in: stale.map((s) => s.id) } },
    });
  }

  state.removeItemsForInstance(instanceId);
  const fresh = await prisma.searchItem.findMany({
    where: { arrInstanceId: instanceId },
  });
  for (const row of fresh) {
    const cached: CachedSearchItem = {
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
    state.indexItem(cached);
  }

  return stats;
}

async function syncOneInstance(
  prepared: PreparedRun,
  state: AppState,
  logger: AppLogger,
): Promise<PerInstanceResult> {
  const { instance } = prepared;
  const order = parseProviderOrder(instance.providerOrder);
  // Lidarr/Readarr don't need a TitleProvider — their fetchAllItems paths
  // ignore it anyway. Sonarr/Radarr without an order = config error, so we
  // fail loudly instead of silently running through.
  const needsProvider = instance.type === "sonarr" || instance.type === "radarr";
  const provider = order ? state.providerForOrder(order) : null;

  if (needsProvider && !provider) {
    logger.warn(
      { instance: instance.name, type: instance.type, order },
      "sync skipped: no provider could be built for the configured order",
    );
    return markRunFailed(
      prepared,
      "No title provider could be built. Configure at least one provider in Settings and review the instance's provider order.",
      { updateInstance: false },
    );
  }
  if (isMaskedSecret(instance.apiKey)) {
    logger.warn({ instance: instance.name, type: instance.type }, "sync skipped: masked api key");
    return markRunFailed(
      prepared,
      "API key is only the Prowlarr mask (********). Set the real key on the instance.",
    );
  }

  try {
    return await fetchAndPersist(prepared, state, provider, order, logger);
  } catch (err) {
    const message = describeError(err);
    logger.error({ instance: instance.name, type: instance.type, err }, "sync error");
    return markRunFailed(prepared, message);
  }
}

async function fetchAndPersist(
  prepared: PreparedRun,
  state: AppState,
  provider: TitleProvider | null,
  order: ProviderId[] | null,
  logger: AppLogger,
): Promise<PerInstanceResult> {
  const { instance } = prepared;
  logger.info(
    {
      instance: instance.name,
      type: instance.type,
      host: instance.host,
      providerOrder: order,
      providerName: provider?.name ?? null,
    },
    "sync start",
  );

  const client = buildArrClient({
    type: instance.type as ArrType,
    instanceId: instance.id,
    instanceName: instance.name,
    host: instance.host,
    apiKey: instance.apiKey,
    userAgent: state.settings.userAgent,
    // Sonarr/Radarr require the provider; Lidarr/Readarr ignore it. The
    // compiler-inferred wider type is narrowed centrally here.
    provider: provider as TitleProvider,
    logger,
  });
  const { items, providerStats } = await withSyncStats(async (stats) => {
    const fetched = await client.fetchAllItems();
    return { items: fetched, providerStats: { ...stats } };
  });

  const withGermanTitle = items.filter((i) => i.germanTitle).length;
  // First few titles without a German title — most useful diagnostic when an
  // operator asks "why didn't movie X get translated?". Capped at 5 so a
  // 4k-library sync doesn't dump 4k titles into the log line.
  const missingGermanSample = items
    .filter((i) => !i.germanTitle)
    .slice(0, 5)
    .map((i) => ({ title: i.title, externalId: i.externalId }));
  logger.info(
    {
      instance: instance.name,
      type: instance.type,
      count: items.length,
      withGermanTitle,
      withoutGermanTitle: items.length - withGermanTitle,
      missingGermanSample: missingGermanSample.length > 0 ? missingGermanSample : undefined,
      pcjonesItems: providerStats.pcjonesItems,
      tmdbItems: providerStats.tmdbItems,
      tvdbItems: providerStats.tvdbItems,
    },
    "sync fetched items",
  );

  const changeStats = await persistAndReindex(state, instance.id, instance.name, items, logger);
  logger.info(
    {
      instance: instance.name,
      type: instance.type,
      created: changeStats.created,
      updated: changeStats.updated,
      removed: changeStats.removed,
      germanTitleChanged: changeStats.germanTitleChanged,
      expectedTitleChanged: changeStats.expectedTitleChanged,
      persistedCount: changeStats.persistedCount,
    },
    "sync persisted",
  );
  return markRunSucceeded(prepared, changeStats.persistedCount, providerStats);
}

export async function runSync(opts: RunSyncOptions): Promise<SyncResult> {
  const state = getAppState();
  const { logger, preparedRuns } = opts;

  const preflightError = checkTmdbPreflight(state);
  if (preflightError) {
    logger.warn(
      {
        plugins: state.languagePack.activePlugins
          .filter((p) => p.language !== "de")
          .map((p) => p.id),
      },
      "sync aborted: TMDB key missing for non-German language plugins",
    );
    const perInstance = await Promise.all(
      preparedRuns.map((prepared) => markRunFailed(prepared, preflightError)),
    );
    return { totalItems: 0, perInstance };
  }

  // Instances are independent (different arrInstanceId, separate SyncRun rows,
  // separate HTTP fetches). Running them in parallel turns wall-time from
  // sum-of-instances into max-of-instances. The SQLite writer lock still
  // serializes the actual upsert transactions, but chunked persistAndReindex
  // releases the lock between batches so the instances interleave instead of
  // fully serializing.
  const perInstance = await Promise.all(
    preparedRuns.map((prepared) => syncOneInstance(prepared, state, logger)),
  );
  const total = perInstance.reduce((sum, r) => sum + r.count, 0);
  return { totalItems: total, perInstance };
}
