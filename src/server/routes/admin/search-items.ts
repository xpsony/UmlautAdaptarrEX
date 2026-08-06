import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/server/auth/middleware";
import { clampInt, parseJsonArray } from "./_helpers";

export async function searchItemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/search-items", { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const q = (req.query as Record<string, string | undefined>) ?? {};
    const take = clampInt(q.take, 50, 1, 250);
    const skip = clampInt(q.skip, 0, 0, 1_000_000);
    // Cap the free-text term: every LIKE '%…%' is a full table scan, so
    // multi-KB patterns would just burn CPU without being a useful search.
    if (q.search) q.search = q.search.slice(0, 256);

    const where: Record<string, unknown> = {};
    if (q.instanceId) where.arrInstanceId = q.instanceId;
    if (q.mediaType) where.mediaType = q.mediaType;
    if (q.missingGerman === "1") where.germanTitle = null;
    if (q.search) {
      where.OR = [
        { title: { contains: q.search } },
        { expectedTitle: { contains: q.search } },
        { germanTitle: { contains: q.search } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.searchItem.findMany({
        where,
        orderBy: { expectedTitle: "asc" },
        take,
        skip,
        // Deliberate projection: arrInstance carries apiKey + host —
        // never spread the relation into an admin response.
        include: {
          arrInstance: { select: { id: true, name: true, type: true } },
        },
      }),
      prisma.searchItem.count({ where }),
    ]);

    // Rows from multiple instances can share the same mediaType+externalId
    // (the same library title synced from two Sonarr instances, say) — dedupe
    // the OR terms by key so we don't send redundant clauses to Prisma. Keyed
    // on a Map (not string-split) since externalId is provider-controlled and
    // could itself contain ":".
    const overrideTargets = new Map<string, { mediaType: string; externalId: string }>();
    for (const r of rows) {
      overrideTargets.set(`${r.mediaType}:${r.externalId}`, {
        mediaType: r.mediaType,
        externalId: r.externalId,
      });
    }
    const overrides =
      overrideTargets.size > 0
        ? await prisma.titleOverride.findMany({
            where: { OR: [...overrideTargets.values()] },
          })
        : [];
    const overrideMap = new Map(
      overrides.map((o) => [`${o.mediaType}:${o.externalId}`, o.germanTitle]),
    );

    const items = rows.map((r) => ({
      id: r.id,
      arrId: r.arrId,
      externalId: r.externalId,
      title: r.title,
      expectedTitle: r.expectedTitle,
      expectedAuthor: r.expectedAuthor,
      germanTitle: r.germanTitle,
      mediaType: r.mediaType,
      year: r.year,
      titleSearchVariations: parseJsonArray(r.titleSearchVariations) ?? [],
      titleMatchVariations: parseJsonArray(r.titleMatchVariations) ?? [],
      authorMatchVariations: parseJsonArray(r.authorMatchVariations) ?? [],
      aliases: parseJsonArray(r.aliases),
      updatedAt: r.updatedAt,
      instance: r.arrInstance,
      override: overrideMap.get(`${r.mediaType}:${r.externalId}`) ?? null,
    }));

    return { items, total, take, skip };
  });
}
