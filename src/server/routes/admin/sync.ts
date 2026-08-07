import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/server/auth/middleware";
import type { SyncScheduler } from "@/server/sync/scheduler";
import { clampInt, resolveSort, type SortWhitelist } from "./_helpers";

// Sortable columns exposed to the sync-runs table. A `sort` outside this map
// (or an invalid `order`) silently falls back to `startedAt desc` — no 400s.
const SYNC_RUNS_SORT: SortWhitelist = {
  startedAt: "startedAt",
  status: "status",
  itemsCount: "itemsCount",
};
const SYNC_RUNS_DEFAULT_SORT_KEY = "startedAt";
const SYNC_RUNS_DEFAULT_ORDER = "desc" as const;

interface SyncRunsEnvelope {
  items: unknown[];
  total: number;
  take: number;
  skip: number;
}

export interface SyncRoutesDeps {
  scheduler: SyncScheduler;
}

export async function syncRoutes(app: FastifyInstance, deps: SyncRoutesDeps): Promise<void> {
  app.post("/api/admin/sync", { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body as { instanceId?: string } | undefined) ?? {};
    const outcome = await deps.scheduler.runNow(body.instanceId);
    if (outcome.status === "no_provider") {
      return reply.code(409).send({
        error: "no_provider",
        message: "No title provider configured. Check titleApiHost in settings.",
      });
    }
    if (outcome.status === "already_running") {
      return reply.code(409).send({
        error: "already_running",
        message: "A sync is already running.",
      });
    }
    if (outcome.status === "no_instances") {
      return reply.code(409).send({
        error: "no_instances",
        message: "No active instances.",
      });
    }
    return reply.code(202).send({
      ok: true,
      runIds: outcome.runIds,
      instanceCount: outcome.instanceCount,
    });
  });

  app.get(
    "/api/admin/sync-runs",
    { preHandler: requireAuth },
    async (req): Promise<SyncRunsEnvelope> => {
      const q = (req.query as Record<string, string | undefined>) ?? {};
      if (q.ids && q.ids.length > 0) {
        // Cap input length and id count so a pathological query string
        // can't push the DB into a 10MB-IN clause.
        if (q.ids.length > 8 * 1024) {
          return { items: [], total: 0, take: 0, skip: 0 };
        }
        const ids = q.ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 200);
        if (ids.length === 0) return { items: [], total: 0, take: 0, skip: 0 };
        const items = await prisma.syncRun.findMany({
          where: { id: { in: ids } },
          orderBy: { startedAt: "desc" },
          include: { arrInstance: { select: { name: true, type: true } } },
        });
        return { items, total: items.length, take: ids.length, skip: 0 };
      }

      // Same shape as `paginatedList` in history.ts (take/skip/search), plus
      // a status filter. Kept as a bespoke implementation rather than reusing
      // that helper directly: SyncRun orders by `startedAt`, not `createdAt`.
      const take = clampInt(q.take, 50, 1, 500);
      const skip = clampInt(q.skip, 0, 0, 100_000);
      // Cap the free-text term: every LIKE '%…%' is a full table scan, so
      // multi-KB patterns would just burn CPU without being a useful search.
      const search = q.search ? q.search.slice(0, 256) : undefined;
      const where: Record<string, unknown> = {};
      if (q.status) where.status = q.status;
      if (search) {
        where.OR = [
          { arrInstance: { is: { name: { contains: search } } } },
          { errorMessage: { contains: search } },
        ];
      }
      const { field, order } = resolveSort(
        q,
        SYNC_RUNS_SORT,
        SYNC_RUNS_DEFAULT_SORT_KEY,
        SYNC_RUNS_DEFAULT_ORDER,
      );
      const [items, total] = await Promise.all([
        prisma.syncRun.findMany({
          where,
          // Low-cardinality columns (status, itemsCount) produce large tie
          // groups when used as the sole ORDER BY — append an id tiebreaker
          // so pagination can't duplicate/skip rows across page boundaries.
          // Mirrors the orderBy tiebreaker in history.ts/search-items.ts.
          orderBy: [{ [field]: order }, { id: "asc" }],
          take,
          skip,
          include: { arrInstance: { select: { name: true, type: true } } },
        }),
        prisma.syncRun.count({ where }),
      ]);
      return { items, total, take, skip };
    },
  );
}
