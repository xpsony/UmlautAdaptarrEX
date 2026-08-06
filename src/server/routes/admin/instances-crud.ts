import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { stripUndefined } from "@/lib/utils";
import {
  ArrInstanceSchema,
  ArrInstanceUpdateSchema,
  type ProviderId,
  TestConnectionSchema,
} from "@/schemas/instance";
import { testConnection } from "@/arr/test-connection";
import { requireAuth } from "@/server/auth/middleware";
import { getAppState } from "@/server/state";
import { isPrismaErrorCode, parseOrReply } from "./_helpers";

const VALID_PROVIDERS: readonly ProviderId[] = ["pcjones", "tvdb", "tmdb"];

/**
 * The DB stores `providerOrder` as CSV ("pcjones,tvdb,tmdb"); UI/REST use
 * arrays. Invalid tokens and duplicates are filtered out defensively.
 */
function csvToArray(csv: string | null): ProviderId[] | null {
  if (!csv) return null;
  const seen = new Set<ProviderId>();
  for (const part of csv.split(",")) {
    const id = part.trim() as ProviderId;
    if (VALID_PROVIDERS.includes(id) && !seen.has(id)) seen.add(id);
  }
  return seen.size > 0 ? Array.from(seen) : null;
}

export function arrayToCsv(arr: readonly ProviderId[] | null | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return arr.join(",");
}

interface DbInstance {
  id: string;
  type: string;
  name: string;
  host: string;
  apiKey: string;
  enabled: boolean;
  providerOrder: string | null;
  enableYearMatching: boolean;
  yearMatchingTolerance: number;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(row: DbInstance): Omit<DbInstance, "providerOrder"> & {
  providerOrder: ProviderId[] | null;
} {
  const { providerOrder, ...rest } = row;
  return { ...rest, providerOrder: csvToArray(providerOrder) };
}

function refreshInstanceOptionsCache(row: DbInstance): void {
  getAppState().setInstanceOptions(row.id, {
    enableYearMatching: row.enableYearMatching,
    yearMatchingTolerance: row.yearMatchingTolerance,
  });
}

export async function instanceCrudRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/instances", { preHandler: requireAuth }, async () => {
    const rows = await prisma.arrInstance.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return rows.map(serialize);
  });

  app.post("/api/admin/instances", { preHandler: requireAuth }, async (req, reply) => {
    const data = parseOrReply(req.body, ArrInstanceSchema, reply);
    if (!data) return;
    try {
      const created = await prisma.arrInstance.create({
        data: {
          ...data,
          providerOrder: arrayToCsv(data.providerOrder),
        },
      });
      refreshInstanceOptionsCache(created);
      req.log.info(
        {
          userId: req.session?.userId ?? null,
          instanceId: created.id,
          type: created.type,
          name: created.name,
          host: created.host,
          enabled: created.enabled,
        },
        "instance created",
      );
      return serialize(created);
    } catch (err) {
      if (isPrismaErrorCode(err, "P2002")) {
        req.log.warn({ type: data.type, name: data.name }, "instance create rejected: duplicate");
        return reply.code(409).send({
          error: "duplicate",
          message: "An instance with this type and name already exists.",
        });
      }
      throw err;
    }
  });

  app.patch("/api/admin/instances/:id", { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const data = parseOrReply(
      { id, ...((req.body as object) ?? {}) },
      ArrInstanceUpdateSchema,
      reply,
    );
    if (!data) return;
    const { id: _id, providerOrder, ...rest } = data;
    const updateData: Record<string, unknown> = stripUndefined(rest);
    // `null` and an array are both valid values for the field; only
    // `undefined` (= not sent) leaves it unchanged.
    if (providerOrder !== undefined) {
      updateData.providerOrder = arrayToCsv(providerOrder);
    }
    let updated: DbInstance;
    try {
      updated = await prisma.arrInstance.update({
        where: { id },
        data: updateData,
      });
    } catch (err) {
      if (isPrismaErrorCode(err, "P2025")) {
        return reply.code(404).send({
          error: "not_found",
          message: "Instance not found.",
        });
      }
      if (isPrismaErrorCode(err, "P2002")) {
        return reply.code(409).send({
          error: "duplicate",
          message: "An instance with this type and name already exists.",
        });
      }
      throw err;
    }
    refreshInstanceOptionsCache(updated);
    req.log.info(
      {
        userId: req.session?.userId ?? null,
        instanceId: updated.id,
        type: updated.type,
        name: updated.name,
        changedFields: Object.keys(updateData),
      },
      "instance updated",
    );
    return serialize(updated);
  });

  app.delete("/api/admin/instances/:id", { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    let removed: DbInstance;
    try {
      removed = await prisma.arrInstance.delete({ where: { id } });
    } catch (err) {
      if (isPrismaErrorCode(err, "P2025")) {
        return reply.code(404).send({
          error: "not_found",
          message: "Instance not found.",
        });
      }
      throw err;
    }
    const state = getAppState();
    state.removeItemsForInstance(id);
    state.removeInstanceOptions(id);
    req.log.warn(
      {
        userId: req.session?.userId ?? null,
        instanceId: removed.id,
        type: removed.type,
        name: removed.name,
      },
      "instance deleted",
    );
    return { ok: true };
  });

  app.post("/api/admin/instances/test", { preHandler: requireAuth }, async (req, reply) => {
    const data = parseOrReply(req.body, TestConnectionSchema, reply);
    if (!data) return;
    const ua = getAppState().settings.userAgent;
    return testConnection(data.type, data.host, data.apiKey, ua, req.log);
  });
}
