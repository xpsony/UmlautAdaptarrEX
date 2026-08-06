import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op */
  },
}));

const { mockTitleOverride, mockSearchItem } = vi.hoisted(() => ({
  mockTitleOverride: {
    upsert: vi.fn(),
    delete: vi.fn(),
  },
  mockSearchItem: {
    count: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { titleOverride: mockTitleOverride, searchItem: mockSearchItem },
}));

const { mockRebuild } = vi.hoisted(() => ({
  mockRebuild: vi.fn(),
}));

vi.mock("@/server/title-overrides/rebuild", () => ({
  rebuildSearchItemsFor: mockRebuild,
}));

import { titleOverrideRoutes } from "@/server/routes/admin/title-overrides";
import { ExternalIdSchema } from "@/schemas/title-override";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  mockTitleOverride.upsert.mockReset();
  mockTitleOverride.delete.mockReset();
  mockSearchItem.count.mockReset();
  mockRebuild.mockReset();

  app = Fastify({ logger: false });
  await titleOverrideRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("PUT /api/admin/title-overrides", () => {
  const validPayload = {
    mediaType: "tv",
    externalId: "42",
    germanTitle: "Dunkel Override",
  };

  it("happy path: upserts, rebuilds, and returns override + rebuiltItems", async () => {
    mockSearchItem.count.mockResolvedValueOnce(1);
    const overrideRow = {
      id: "o1",
      mediaType: "tv",
      externalId: "42",
      germanTitle: "Dunkel Override",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    mockTitleOverride.upsert.mockResolvedValueOnce(overrideRow);
    mockRebuild.mockResolvedValueOnce({ rebuiltItems: 2 });

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/title-overrides",
      payload: validPayload,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      override: {
        ...overrideRow,
        createdAt: overrideRow.createdAt.toISOString(),
        updatedAt: overrideRow.updatedAt.toISOString(),
      },
      rebuiltItems: 2,
    });
    expect(mockRebuild).toHaveBeenCalledWith("tv", "42");
    expect(mockTitleOverride.upsert).toHaveBeenCalledWith({
      where: { mediaType_externalId: { mediaType: "tv", externalId: "42" } },
      create: validPayload,
      update: { germanTitle: "Dunkel Override" },
    });
  });

  it("returns 404 and skips upsert/rebuild when no matching item exists", async () => {
    mockSearchItem.count.mockResolvedValueOnce(0);

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/title-overrides",
      payload: validPayload,
    });

    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: "not_found" });
    expect(mockTitleOverride.upsert).not.toHaveBeenCalled();
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid mediaType", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/title-overrides",
      payload: { ...validPayload, mediaType: "series" },
    });

    expect(r.statusCode).toBe(400);
    expect(mockSearchItem.count).not.toHaveBeenCalled();
    expect(mockTitleOverride.upsert).not.toHaveBeenCalled();
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty germanTitle", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/title-overrides",
      payload: { ...validPayload, germanTitle: "" },
    });

    expect(r.statusCode).toBe(400);
  });

  it("returns 400 for a whitespace-only germanTitle", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/title-overrides",
      payload: { ...validPayload, germanTitle: "   " },
    });

    expect(r.statusCode).toBe(400);
  });
});

describe("DELETE /api/admin/title-overrides/:mediaType/:externalId", () => {
  it("happy path: deletes, rebuilds, and returns ok + rebuiltItems", async () => {
    mockTitleOverride.delete.mockResolvedValueOnce({
      id: "o1",
      mediaType: "tv",
      externalId: "42",
      germanTitle: "Dunkel Override",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    mockRebuild.mockResolvedValueOnce({ rebuiltItems: 3 });

    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/title-overrides/tv/42",
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, rebuiltItems: 3 });
    expect(mockTitleOverride.delete).toHaveBeenCalledWith({
      where: { mediaType_externalId: { mediaType: "tv", externalId: "42" } },
    });
    expect(mockRebuild).toHaveBeenCalledWith("tv", "42");
  });

  it("returns 404 and skips rebuild when Prisma rejects with P2025", async () => {
    mockTitleOverride.delete.mockRejectedValueOnce({ code: "P2025" });

    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/title-overrides/tv/42",
    });

    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: "not_found" });
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid mediaType in the URL", async () => {
    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/title-overrides/series/42",
    });

    expect(r.statusCode).toBe(400);
    expect(mockTitleOverride.delete).not.toHaveBeenCalled();
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("rejects an externalId longer than 256 chars without reaching prisma", async () => {
    const longId = "x".repeat(300);
    const r = await app.inject({
      method: "DELETE",
      url: `/api/admin/title-overrides/tv/${longId}`,
    });

    // Fastify's router (find-my-way) caps URL params at 100 chars by
    // default and answers 414 before our route handler — and its
    // ExternalIdSchema check — ever runs. Either way the request never
    // reaches prisma, which is the property that matters; the schema
    // check below (`ExternalIdSchema`) exercises the same bound directly
    // for callers not gated by the router (e.g. a future non-HTTP caller,
    // or if `maxParamLength` is ever raised).
    expect([400, 414]).toContain(r.statusCode);
    expect(mockTitleOverride.delete).not.toHaveBeenCalled();
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("ExternalIdSchema rejects a value longer than 256 chars", () => {
    const result = ExternalIdSchema.safeParse("x".repeat(300));
    expect(result.success).toBe(false);
  });
});
