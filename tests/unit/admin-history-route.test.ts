import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op */
  },
}));

const { mockReq, mockRename, mockLog } = vi.hoisted(() => ({
  mockReq: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  mockRename: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  mockLog: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    requestHistory: mockReq,
    renameHistory: mockRename,
    logEntry: mockLog,
  },
}));

import { historyRoutes } from "@/server/routes/admin/history";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  for (const m of [mockReq, mockRename, mockLog]) {
    m.findMany.mockReset();
    m.count.mockReset();
  }
  app = Fastify({ logger: false });
  await historyRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/admin/request-history", () => {
  it("returns items, total, take, skip with default paging", async () => {
    mockReq.findMany.mockResolvedValueOnce([{ id: "r1" }]);
    mockReq.count.mockResolvedValueOnce(1);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/request-history",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      items: [{ id: "r1" }],
      total: 1,
      take: 50,
      skip: 0,
    });
  });

  it("forwards type and domain filters into the where clause", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/request-history?type=caps&domain=example.com",
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toEqual({ type: "caps", domain: "example.com" });
  });

  it("supports a free-text search over query, externalId and domain", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/request-history?search=galaxy",
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as {
      where: { OR: unknown[] };
    };
    expect(args.where.OR).toEqual([
      { query: { contains: "galaxy" } },
      { externalId: { contains: "galaxy" } },
      { domain: { contains: "galaxy" } },
    ]);
  });

  it("caps the search term at 256 chars", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: `/api/admin/request-history?search=${"a".repeat(300)}`,
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<{ query: { contains: string } }> };
    };
    expect(args.where.OR[0]?.query.contains).toHaveLength(256);
  });

  it("clamps take to the configured maximum", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/request-history?take=999",
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as { take: number };
    expect(args.take).toBe(500);
  });

  it("orders by createdAt desc by default", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({ method: "GET", url: "/api/admin/request-history" });
    const args = mockReq.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("accepts a whitelisted sort key with an explicit order", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/request-history?sort=status&order=asc",
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ status: "asc" });
  });

  it("flips order between asc and desc for the same sort key", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/request-history?sort=durationMs&order=desc",
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ durationMs: "desc" });
  });

  it("falls back to the default sort key when sort is not whitelisted", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/request-history?sort=apiKey&order=asc",
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ createdAt: "asc" });
  });

  it("falls back to the default order when order is not asc/desc", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/request-history?sort=status&order=sideways",
    });
    const args = mockReq.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ status: "desc" });
  });
});

describe("GET /api/admin/rename-history", () => {
  it("supports a free-text search via OR-of-contains", async () => {
    mockRename.findMany.mockResolvedValueOnce([]);
    mockRename.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/rename-history?search=foo&mediaType=movie",
    });
    const args = mockRename.findMany.mock.calls[0]?.[0] as {
      where: { mediaType: string; OR: unknown[] };
    };
    expect(args.where.mediaType).toBe("movie");
    expect(Array.isArray(args.where.OR)).toBe(true);
    expect(args.where.OR.length).toBe(2);
  });

  it("orders by createdAt desc by default", async () => {
    mockRename.findMany.mockResolvedValueOnce([]);
    mockRename.count.mockResolvedValueOnce(0);
    await app.inject({ method: "GET", url: "/api/admin/rename-history" });
    const args = mockRename.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("accepts the whitelisted mediaType sort key", async () => {
    mockRename.findMany.mockResolvedValueOnce([]);
    mockRename.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/rename-history?sort=mediaType&order=asc",
    });
    const args = mockRename.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ mediaType: "asc" });
  });

  it("falls back to the default sort key when sort is not whitelisted", async () => {
    mockRename.findMany.mockResolvedValueOnce([]);
    mockRename.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/rename-history?sort=originalTitle",
    });
    const args = mockRename.findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });
});

describe("GET /api/admin/logs", () => {
  it("returns only items (no total/take/skip envelope)", async () => {
    mockLog.findMany.mockResolvedValueOnce([{ id: 1, message: "hello" }]);
    mockLog.count.mockResolvedValueOnce(1);
    const r = await app.inject({ method: "GET", url: "/api/admin/logs" });
    expect(r.json()).toEqual({ items: [{ id: 1, message: "hello" }] });
  });

  it("forwards level and search into the where clause", async () => {
    mockLog.findMany.mockResolvedValueOnce([]);
    mockLog.count.mockResolvedValueOnce(0);
    await app.inject({
      method: "GET",
      url: "/api/admin/logs?level=warn&search=boom",
    });
    const args = mockLog.findMany.mock.calls[0]?.[0] as {
      where: { level: string; message: { contains: string } };
    };
    expect(args.where.level).toBe("warn");
    expect(args.where.message).toEqual({ contains: "boom" });
  });
});

describe("GET /api/admin/stats", () => {
  it("computes summary counts and bucketed series", async () => {
    const now = Date.now();
    const recentHit = new Date(now - 30 * 60 * 1000); // 30 min ago, hit
    const recentMiss = new Date(now - 90 * 60 * 1000); // 1.5h ago, miss
    const renameToday = new Date(now - 60 * 1000);

    mockReq.findMany.mockResolvedValueOnce([
      { createdAt: recentHit, cacheHit: true },
      { createdAt: recentMiss, cacheHit: false },
    ]);
    mockRename.findMany.mockResolvedValueOnce([{ createdAt: renameToday }]);
    mockReq.count
      .mockResolvedValueOnce(2) // totalRequests24h
      .mockResolvedValueOnce(1); // cacheHits24h
    mockRename.count
      .mockResolvedValueOnce(1) // totalRenames24h
      .mockResolvedValueOnce(1); // totalRenames14d

    const r = await app.inject({ method: "GET", url: "/api/admin/stats" });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      summary: { requests24h: number; cacheHitRate: number };
      requestsHourly: { ts: string; hit: number; miss: number }[];
      renamesDaily: { ts: string; count: number }[];
    };
    expect(body.summary.requests24h).toBe(2);
    expect(body.summary.cacheHitRate).toBe(0.5);
    expect(body.requestsHourly).toHaveLength(24);
    expect(body.renamesDaily).toHaveLength(14);
  });

  it("returns cacheHitRate=0 when no requests were made", async () => {
    mockReq.findMany.mockResolvedValueOnce([]);
    mockRename.findMany.mockResolvedValueOnce([]);
    mockReq.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mockRename.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const r = await app.inject({ method: "GET", url: "/api/admin/stats" });
    const body = r.json() as { summary: { cacheHitRate: number } };
    expect(body.summary.cacheHitRate).toBe(0);
  });
});
