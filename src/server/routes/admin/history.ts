import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/server/auth/middleware";
import { clampInt, resolveSort, type SortWhitelist } from "./_helpers";

interface PaginatedModel {
  findMany: (args: object) => Promise<unknown[]>;
  count: (args: object) => Promise<number>;
}

/** Sort configuration for `paginatedList`; omit to keep the `createdAt desc` default. */
interface SortOptions {
  whitelist: SortWhitelist;
  defaultKey: string;
  defaultOrder?: "asc" | "desc";
}

async function paginatedList(
  req: FastifyRequest,
  model: PaginatedModel,
  buildWhere: (q: Record<string, string | undefined>) => Record<string, unknown>,
  defaultTake = 50,
  maxTake = 500,
  sortOptions?: SortOptions,
): Promise<{ items: unknown[]; total: number; take: number; skip: number }> {
  const q = (req.query as Record<string, string | undefined>) ?? {};
  const take = clampInt(q.take, defaultTake, 1, maxTake);
  const skip = clampInt(q.skip, 0, 0, 100_000);
  // Cap the free-text term: every LIKE '%…%' is a full table scan, so
  // multi-KB patterns would just burn CPU without being a useful search.
  if (q.search) q.search = q.search.slice(0, 256);
  const where = buildWhere(q);
  const orderBy = sortOptions
    ? (() => {
        const { field, order } = resolveSort(
          q,
          sortOptions.whitelist,
          sortOptions.defaultKey,
          sortOptions.defaultOrder,
        );
        return { [field]: order };
      })()
    : { createdAt: "desc" as const };
  const [items, total] = await Promise.all([
    model.findMany({ where, orderBy, take, skip }),
    model.count({ where }),
  ]);
  return { items, total, take, skip };
}

// Sortable columns exposed to the request-history table. `sort` values that
// don't match a key here (and any invalid `order`) silently fall back to the
// default below — no 400s for an unrecognized sort/order combination.
const REQUEST_HISTORY_SORT: SortOptions = {
  whitelist: {
    createdAt: "createdAt",
    status: "status",
    durationMs: "durationMs",
    domain: "domain",
    type: "type",
  },
  defaultKey: "createdAt",
  defaultOrder: "desc",
};

const RENAME_HISTORY_SORT: SortOptions = {
  whitelist: {
    createdAt: "createdAt",
    mediaType: "mediaType",
  },
  defaultKey: "createdAt",
  defaultOrder: "desc",
};

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/request-history", { preHandler: requireAuth }, (req) =>
    paginatedList(
      req,
      prisma.requestHistory,
      (q) => {
        const where: Record<string, unknown> = {};
        if (q.type) where.type = q.type;
        if (q.domain) where.domain = q.domain;
        if (q.search) {
          where.OR = [
            { query: { contains: q.search } },
            { externalId: { contains: q.search } },
            { domain: { contains: q.search } },
          ];
        }
        return where;
      },
      50,
      500,
      REQUEST_HISTORY_SORT,
    ),
  );

  app.get("/api/admin/rename-history", { preHandler: requireAuth }, (req) =>
    paginatedList(
      req,
      prisma.renameHistory,
      (q) => {
        const where: Record<string, unknown> = {};
        if (q.mediaType) where.mediaType = q.mediaType;
        if (q.search) {
          where.OR = [
            { originalTitle: { contains: q.search } },
            { rewrittenTitle: { contains: q.search } },
          ];
        }
        return where;
      },
      50,
      500,
      RENAME_HISTORY_SORT,
    ),
  );

  app.get("/api/admin/logs", { preHandler: requireAuth }, async (req) => {
    const { items } = await paginatedList(
      req,
      prisma.logEntry,
      (q) => {
        const where: Record<string, unknown> = {};
        if (q.level) where.level = q.level;
        if (q.search) where.message = { contains: q.search };
        return where;
      },
      100,
      1000,
    );
    return { items };
  });

  app.get("/api/admin/stats", { preHandler: requireAuth }, async () => {
    const now = Date.now();
    // Hourly buckets for the last 24h (requests). The bucket is the start of
    // the hour in *local server time* — the UI just plots them, we don't try
    // to be timezone-aware here.
    const since24h = new Date(now - 24 * 60 * 60 * 1000);
    const since14d = new Date(now - 14 * 24 * 60 * 60 * 1000);

    const [
      requests24h,
      renames14d,
      totalRequests24h,
      cacheHits24h,
      totalRenames24h,
      totalRenames14d,
    ] = await Promise.all([
      prisma.requestHistory.findMany({
        where: { createdAt: { gte: since24h } },
        select: { createdAt: true, cacheHit: true },
      }),
      prisma.renameHistory.findMany({
        where: { createdAt: { gte: since14d } },
        select: { createdAt: true },
      }),
      prisma.requestHistory.count({ where: { createdAt: { gte: since24h } } }),
      prisma.requestHistory.count({
        where: { createdAt: { gte: since24h }, cacheHit: true },
      }),
      prisma.renameHistory.count({
        where: { createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
      }),
      prisma.renameHistory.count({ where: { createdAt: { gte: since14d } } }),
    ]);

    const requestBuckets = bucketByHour(requests24h, now, 24);
    const renameBuckets = bucketByDay(renames14d, now, 14);

    return {
      summary: {
        requests24h: totalRequests24h,
        cacheHits24h,
        cacheHitRate: totalRequests24h > 0 ? cacheHits24h / totalRequests24h : 0,
        renames24h: totalRenames24h,
        renames14d: totalRenames14d,
      },
      requestsHourly: requestBuckets,
      renamesDaily: renameBuckets,
    };
  });
}

interface RequestRow {
  createdAt: Date;
  cacheHit: boolean;
}

interface RenameRow {
  createdAt: Date;
}

function bucketByHour(
  rows: RequestRow[],
  nowMs: number,
  hours: number,
): { ts: string; hit: number; miss: number }[] {
  const HOUR = 60 * 60 * 1000;
  const startOfBucket = (ms: number): number => Math.floor(ms / HOUR) * HOUR;
  const firstBucket = startOfBucket(nowMs - (hours - 1) * HOUR);
  const buckets = new Map<number, { hit: number; miss: number }>();
  for (let i = 0; i < hours; i++) {
    buckets.set(firstBucket + i * HOUR, { hit: 0, miss: 0 });
  }
  for (const row of rows) {
    const b = startOfBucket(row.createdAt.getTime());
    const slot = buckets.get(b);
    if (!slot) continue;
    if (row.cacheHit) slot.hit += 1;
    else slot.miss += 1;
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, v]) => ({ ts: new Date(ts).toISOString(), ...v }));
}

function bucketByDay(
  rows: RenameRow[],
  nowMs: number,
  days: number,
): { ts: string; count: number }[] {
  const DAY = 24 * 60 * 60 * 1000;
  // Local-day bucket: midnight in server timezone. Using local instead of UTC
  // so the chart aligns with what the operator sees on their wall clock.
  const startOfLocalDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const firstBucket = startOfLocalDay(nowMs - (days - 1) * DAY);
  const buckets = new Map<number, number>();
  for (let i = 0; i < days; i++) {
    buckets.set(firstBucket + i * DAY, 0);
  }
  for (const row of rows) {
    const b = startOfLocalDay(row.createdAt.getTime());
    if (buckets.has(b)) buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, count]) => ({ ts: new Date(ts).toISOString(), count }));
}
