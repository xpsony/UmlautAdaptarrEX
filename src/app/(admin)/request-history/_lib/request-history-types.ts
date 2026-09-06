/**
 * Wire shape of a request-history row as returned by `GET
 * /api/admin/request-history` (`src/server/routes/admin/history.ts`), which is
 * `prisma.requestHistory.findMany` with the model's default field set. Shared
 * by the list client and the read-only detail sheet.
 */
export interface RequestHistoryRow {
  id: string;
  type: string;
  domain: string;
  query: string | null;
  externalId: string | null;
  status: number;
  durationMs: number;
  cacheHit: boolean;
  createdAt: string;
}
