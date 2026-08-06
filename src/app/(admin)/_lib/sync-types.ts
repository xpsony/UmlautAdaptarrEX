/**
 * Wire shape of a sync run as returned by `GET /api/admin/sync-runs`
 * (`src/server/routes/admin/sync.ts`), which is `prisma.syncRun.findMany`
 * with `arrInstance` narrowed to `{ name, type }`. Shared by the dashboard's
 * recent-runs card and the full sync-runs list — both render the same
 * fields, so this is one honest type rather than two near-duplicates.
 */
export interface SyncRun {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  itemsCount: number;
  pcjonesItemsCount: number;
  tmdbItemsCount: number;
  tvdbItemsCount: number;
  errorMessage: string | null;
  arrInstance: { name: string; type: string } | null;
}
