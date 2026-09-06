import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op for unit tests */
  },
}));

const { mockSyncRun } = vi.hoisted(() => ({
  mockSyncRun: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { syncRun: mockSyncRun },
}));

import { syncRoutes } from "@/server/routes/admin/sync";

interface FakeScheduler {
  runNow: ReturnType<typeof vi.fn>;
}

let app: ReturnType<typeof Fastify>;
let scheduler: FakeScheduler;

beforeEach(async () => {
  mockSyncRun.findMany.mockReset();
  mockSyncRun.count.mockReset();
  mockSyncRun.count.mockResolvedValue(0);
  scheduler = { runNow: vi.fn() };
  app = Fastify({ logger: false });
  await syncRoutes(app, { scheduler: scheduler as never });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("POST /api/admin/sync", () => {
  it("returns 202 when the scheduler accepts the run", async () => {
    scheduler.runNow.mockResolvedValueOnce({
      status: "started",
      runIds: ["r1", "r2"],
      instanceCount: 2,
    });
    const r = await app.inject({ method: "POST", url: "/api/admin/sync" });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({
      ok: true,
      runIds: ["r1", "r2"],
      instanceCount: 2,
    });
  });

  it("forwards the optional instanceId from the body", async () => {
    scheduler.runNow.mockResolvedValueOnce({
      status: "started",
      runIds: ["r1"],
      instanceCount: 1,
    });
    await app.inject({
      method: "POST",
      url: "/api/admin/sync",
      payload: { instanceId: "abc-123" },
    });
    expect(scheduler.runNow).toHaveBeenCalledWith("abc-123");
  });

  it("maps no_provider to a 409", async () => {
    scheduler.runNow.mockResolvedValueOnce({ status: "no_provider" });
    const r = await app.inject({ method: "POST", url: "/api/admin/sync" });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_provider" });
  });

  it("maps already_running to a 409", async () => {
    scheduler.runNow.mockResolvedValueOnce({ status: "already_running" });
    const r = await app.inject({ method: "POST", url: "/api/admin/sync" });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "already_running" });
  });

  it("maps no_instances to a 409", async () => {
    scheduler.runNow.mockResolvedValueOnce({ status: "no_instances" });
    const r = await app.inject({ method: "POST", url: "/api/admin/sync" });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_instances" });
  });
});

describe("GET /api/admin/sync-runs", () => {
  it("returns the most recent runs with default take/skip and the paginated envelope", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([{ id: "r1" }, { id: "r2" }]);
    mockSyncRun.count.mockResolvedValueOnce(2);
    const r = await app.inject({ method: "GET", url: "/api/admin/sync-runs" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      items: [{ id: "r1" }, { id: "r2" }],
      total: 2,
      take: 50,
      skip: 0,
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as {
      take: number;
      skip: number;
      orderBy: unknown;
    };
    expect(args.take).toBe(50);
    expect(args.skip).toBe(0);
    expect(args.orderBy).toEqual([{ startedAt: "desc" }, { id: "asc" }]);
  });

  it("honors an explicit take/skip", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?take=8&skip=16",
    });
    expect(r.json()).toMatchObject({ take: 8, skip: 16 });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as {
      take: number;
      skip: number;
    };
    expect(args.take).toBe(8);
    expect(args.skip).toBe(16);
  });

  it("clamps the take parameter at 500 (the 200-row hardcap is gone)", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?take=99999",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { take: number };
    expect(args.take).toBe(500);
  });

  it("filters by status", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?status=error",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as {
      where: { status?: string };
    };
    expect(args.where.status).toBe("error");
    expect(mockSyncRun.count).toHaveBeenCalledWith({ where: { status: "error" } });
  });

  it("filters by search across the instance name relation and the error message", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?search=Sonarr",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as {
      where: { OR: unknown[] };
    };
    expect(args.where.OR).toEqual([
      { arrInstance: { is: { name: { contains: "Sonarr" } } } },
      { errorMessage: { contains: "Sonarr" } },
    ]);
  });

  it("caps the search term at 256 chars", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    const longSearch = "a".repeat(500);
    await app.inject({
      method: "GET",
      url: `/api/admin/sync-runs?search=${longSearch}`,
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as {
      where: { OR: [{ arrInstance: { is: { name: { contains: string } } } }] };
    };
    expect(args.where.OR[0].arrInstance.is.name.contains).toHaveLength(256);
  });

  it("combines search and status", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?search=Sonarr&status=success",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as {
      where: { status?: string; OR?: unknown[] };
    };
    expect(args.where.status).toBe("success");
    expect(args.where.OR).toHaveLength(2);
  });

  it("queries by ids when the ids parameter is supplied, still wrapped in the envelope", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?ids=a,b,c,",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as {
      where: { id: { in: string[] } };
    };
    expect(args.where.id.in).toEqual(["a", "b", "c"]);
    expect(r.json()).toEqual({
      items: [{ id: "a" }, { id: "b" }],
      total: 2,
      take: 3,
      skip: 0,
    });
  });

  it("returns an empty envelope when ids resolves to none", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?ids=,,",
    });
    expect(r.json()).toEqual({ items: [], total: 0, take: 0, skip: 0 });
    expect(mockSyncRun.findMany).not.toHaveBeenCalled();
  });

  it("accepts a whitelisted sort key with an explicit order", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?sort=itemsCount&order=asc",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ itemsCount: "asc" }, { id: "asc" }]);
  });

  it("accepts the status sort key", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?sort=status&order=desc",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ status: "desc" }, { id: "asc" }]);
  });

  it("falls back to the default sort key when sort is not whitelisted", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?sort=arrInstanceId&order=asc",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ startedAt: "asc" }, { id: "asc" }]);
  });

  it("falls back to the default order when order is invalid", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?sort=itemsCount&order=bogus",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ itemsCount: "desc" }, { id: "asc" }]);
  });

  it("keeps a stable id tiebreaker after a low-cardinality, non-default sort", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?sort=status&order=asc",
    });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { orderBy: unknown[] };
    expect(args.orderBy).toHaveLength(2);
    expect(args.orderBy[1]).toEqual({ id: "asc" });
  });

  it("rejects pathologically long ids strings", async () => {
    const huge = "x," + "y,".repeat(10_000);
    const r = await app.inject({
      method: "GET",
      url: `/api/admin/sync-runs?ids=${huge}`,
    });
    expect(r.json()).toEqual({ items: [], total: 0, take: 0, skip: 0 });
    expect(mockSyncRun.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/sync-runs kind filter", () => {
  it("filters by kind=delta", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({ method: "GET", url: "/api/admin/sync-runs?kind=delta" });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where.kind).toBe("delta");
  });

  it("filters by kind=full", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({ method: "GET", url: "/api/admin/sync-runs?kind=full" });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where.kind).toBe("full");
  });

  it("ignores an unknown kind instead of returning nothing", async () => {
    mockSyncRun.findMany.mockResolvedValueOnce([]);
    mockSyncRun.count.mockResolvedValueOnce(0);
    await app.inject({ method: "GET", url: "/api/admin/sync-runs?kind=nonsense" });
    const args = mockSyncRun.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty("kind");
  });
});
