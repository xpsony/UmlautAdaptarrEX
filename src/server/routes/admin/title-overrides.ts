import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { MediaTypeSchema, TitleOverridePutSchema } from "@/schemas/title-override";
import { requireAuth } from "@/server/auth/middleware";
import { rebuildSearchItemsFor } from "@/server/title-overrides/rebuild";
import { isPrismaErrorCode, parseOrReply } from "./_helpers";

export async function titleOverrideRoutes(app: FastifyInstance): Promise<void> {
  app.put("/api/admin/title-overrides", { preHandler: requireAuth }, async (req, reply) => {
    const data = parseOrReply(req.body, TitleOverridePutSchema, reply);
    if (!data) return;
    // Overrides are only created from the detail view of an existing item;
    // reject unknown targets so typos can't create orphan rows.
    const itemCount = await prisma.searchItem.count({
      where: { mediaType: data.mediaType, externalId: data.externalId },
    });
    if (itemCount === 0) {
      return reply.code(404).send({
        error: "not_found",
        message: "No library item matches this mediaType and externalId.",
      });
    }
    const override = await prisma.titleOverride.upsert({
      where: {
        mediaType_externalId: {
          mediaType: data.mediaType,
          externalId: data.externalId,
        },
      },
      create: data,
      update: { germanTitle: data.germanTitle },
    });
    const { rebuiltItems } = await rebuildSearchItemsFor(data.mediaType, data.externalId);
    req.log.info(
      {
        userId: req.session?.userId ?? null,
        mediaType: data.mediaType,
        externalId: data.externalId,
        germanTitle: data.germanTitle,
        rebuiltItems,
      },
      "title override saved",
    );
    return { override, rebuiltItems };
  });

  app.delete(
    "/api/admin/title-overrides/:mediaType/:externalId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const params = req.params as { mediaType: string; externalId: string };
      const mediaType = MediaTypeSchema.safeParse(params.mediaType);
      if (!mediaType.success) {
        return reply.code(400).send({ error: "invalid", message: "Unknown media type." });
      }
      try {
        await prisma.titleOverride.delete({
          where: {
            mediaType_externalId: {
              mediaType: mediaType.data,
              externalId: params.externalId,
            },
          },
        });
      } catch (err) {
        if (isPrismaErrorCode(err, "P2025")) {
          return reply.code(404).send({
            error: "not_found",
            message: "No override exists for this item.",
          });
        }
        throw err;
      }
      const { rebuiltItems } = await rebuildSearchItemsFor(mediaType.data, params.externalId);
      req.log.info(
        {
          userId: req.session?.userId ?? null,
          mediaType: mediaType.data,
          externalId: params.externalId,
          rebuiltItems,
        },
        "title override removed",
      );
      return { ok: true, rebuiltItems };
    },
  );
}
