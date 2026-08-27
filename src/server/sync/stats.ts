import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-sync provider stats accumulator. Lives only as long as a single
 * `runSync` instance loop iteration so we can persist outbound API hit counts
 * to the SyncRun row alongside the total Arr item count.
 *
 * The composite title provider records into the active context (if any) when
 * it dispatches to pcjones / TMDB. Cache hits served by `DbCachedTitleProvider`
 * never reach composite, so they implicitly don't get counted - which is the
 * goal: the UI surfaces real API usage, not cache replays.
 *
 * Counts are *items returned by the provider*, not requests. A bulk call that
 * returns N payloads adds N. The same externalId can count toward both pcjones
 * and TMDB when both provided complementary languages for the same item - that
 * matches what the UI displays ("which providers were hit").
 */
export interface SyncStats {
  pcjonesItems: number;
  tmdbItems: number;
  tvdbItems: number;
}

const storage = new AsyncLocalStorage<SyncStats>();

export function withSyncStats<T>(
  fn: (stats: SyncStats) => Promise<T>,
): Promise<T> {
  const stats: SyncStats = { pcjonesItems: 0, tmdbItems: 0, tvdbItems: 0 };
  return storage.run(stats, () => fn(stats));
}

export function recordPcjonesHits(count: number): void {
  if (count <= 0) return;
  const ctx = storage.getStore();
  if (ctx) ctx.pcjonesItems += count;
}

export function recordTmdbHits(count: number): void {
  if (count <= 0) return;
  const ctx = storage.getStore();
  if (ctx) ctx.tmdbItems += count;
}

export function recordTvdbHits(count: number): void {
  if (count <= 0) return;
  const ctx = storage.getStore();
  if (ctx) ctx.tvdbItems += count;
}
