import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fetchProwlarrIndexerHosts } from "@/arr/prowlarr";
import { prisma } from "@/lib/db";
import {
  IndexerHostSchema,
  type IndexerListResponse,
  IndexerVariationSettingSchema,
} from "@/schemas/indexer-setting";
import { requireAuth } from "@/server/auth/middleware";
import { mergeIndexerList } from "@/server/indexers/list";
import { getAppState } from "@/server/state";
import { parseOrReply } from "./_helpers";

// The list calls Prowlarr, so it carries the same per-IP limit as the other
// admin routes that reach an external host.
const LIST_RATE_LIMIT = {
  max: 30,
  timeWindow: "1 minute",
  keyGenerator: (req: FastifyRequest): string => req.ip,
};

function parseHost(raw: unknown, reply: FastifyReply): string | null {
  const host = IndexerHostSchema.safeParse(raw);
  if (!host.success) {
    reply.code(400).send({ error: "invalid", message: "Invalid indexer host." });
    return null;
  }
  return host.data;
}

// Prowlarr only contributes names: without credentials, or when the call
// fails, the list still comes back, just unnamed.
async function prowlarrHosts(log: FastifyBaseLogger): Promise<{ host: string; name: string }[]> {
  const setting = await prisma.setting.findUnique({
    where: { id: 1 },
    select: { prowlarrHost: true, prowlarrApiKey: true },
  });
  if (!setting?.prowlarrHost || !setting.prowlarrApiKey) return [];
  return fetchProwlarrIndexerHosts(
    setting.prowlarrHost,
    setting.prowlarrApiKey,
    getAppState().settings.userAgent,
    log,
  );
}

export async function indexerRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: requireAuth } as const;

  app.get(
    "/api/admin/indexers",
    { preHandler: requireAuth, config: { rateLimit: LIST_RATE_LIMIT } },
    async (req): Promise<IndexerListResponse> => {
      const [history, rows, prowlarr] = await Promise.all([
        prisma.requestHistory.groupBy({ by: ["domain"], _max: { createdAt: true } }),
        prisma.indexerSetting.findMany(),
        prowlarrHosts(req.log),
      ]);
      return {
        indexers: mergeIndexerList(
          history.map((h) => ({ domain: h.domain, lastSearchAt: h._max.createdAt })),
          prowlarr,
          rows,
        ),
      };
    },
  );

  app.put("/api/admin/indexers/:host", auth, async (req, reply) => {
    const host = parseHost((req.params as { host?: string }).host, reply);
    if (!host) return;
    const setting = parseOrReply(req.body, IndexerVariationSettingSchema, reply);
    if (!setting) return;
    await prisma.indexerSetting.upsert({
      where: { host },
      create: { host, ...setting },
      update: setting,
    });
    getAppState().setIndexerSetting(host, setting);
    req.log.info({ host, ...setting }, "indexer variation setting saved");
    return { host, custom: setting };
  });

  app.delete("/api/admin/indexers/:host", auth, async (req, reply) => {
    const host = parseHost((req.params as { host?: string }).host, reply);
    if (!host) return;
    await prisma.indexerSetting.deleteMany({ where: { host } });
    getAppState().setIndexerSetting(host, null);
    req.log.info({ host }, "indexer variation setting reset to global");
    return { host, custom: null };
  });
}
