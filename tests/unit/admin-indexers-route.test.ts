import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op */
  },
}));

const { mockDb, mockState, mockHosts } = vi.hoisted(() => ({
  mockDb: {
    requestHistory: { groupBy: vi.fn() },
    indexerSetting: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    setting: { findUnique: vi.fn() },
  },
  mockState: { settings: { userAgent: "UA" }, setIndexerSwitches: vi.fn() },
  mockHosts: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockDb }));
vi.mock("@/server/state", () => ({ getAppState: () => mockState }));
vi.mock("@/arr/prowlarr", () => ({ fetchProwlarrIndexerHosts: mockHosts }));

import { indexerRoutes } from "@/server/routes/admin/indexers";

let app: FastifyInstance;

beforeEach(async () => {
  for (const fn of [
    mockDb.requestHistory.groupBy,
    mockDb.indexerSetting.findMany,
    mockDb.indexerSetting.upsert,
    mockDb.indexerSetting.deleteMany,
    mockDb.setting.findUnique,
    mockState.setIndexerSwitches,
    mockHosts,
  ]) {
    fn.mockReset();
  }
  app = Fastify();
  await indexerRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const switches = { tv: true, movie: false, audio: true, book: false };

describe("GET /api/admin/indexers", () => {
  it("merges history, Prowlarr names and rows", async () => {
    mockDb.requestHistory.groupBy.mockResolvedValue([
      { domain: "idx.test", _max: { createdAt: new Date("2026-10-20T10:00:00Z") } },
    ]);
    mockDb.indexerSetting.findMany.mockResolvedValue([]);
    mockDb.setting.findUnique.mockResolvedValue({
      prowlarrHost: "http://p:9696",
      prowlarrApiKey: "k",
    });
    mockHosts.mockResolvedValue([{ host: "idx.test", name: "Indexer One" }]);

    const res = await app.inject({ method: "GET", url: "/api/admin/indexers" });

    expect(res.statusCode).toBe(200);
    expect(res.json().indexers).toEqual([
      {
        host: "idx.test",
        name: "Indexer One",
        lastSearchAt: "2026-10-20T10:00:00.000Z",
        custom: null,
      },
    ]);
    expect(mockHosts).toHaveBeenCalledWith("http://p:9696", "k", "UA", expect.anything());
  });

  it("still answers without Prowlarr credentials", async () => {
    mockDb.requestHistory.groupBy.mockResolvedValue([]);
    mockDb.indexerSetting.findMany.mockResolvedValue([]);
    mockDb.setting.findUnique.mockResolvedValue({ prowlarrHost: null, prowlarrApiKey: null });

    const res = await app.inject({ method: "GET", url: "/api/admin/indexers" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ indexers: [] });
    expect(mockHosts).not.toHaveBeenCalled();
  });
});

describe("PUT/DELETE /api/admin/indexers/:host", () => {
  it("upserts a row, lower-cases the host and refreshes the state", async () => {
    mockDb.indexerSetting.upsert.mockResolvedValue({ host: "idx.test", ...switches });

    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/indexers/IDX.test",
      payload: switches,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.indexerSetting.upsert).toHaveBeenCalledWith({
      where: { host: "idx.test" },
      create: { host: "idx.test", ...switches },
      update: switches,
    });
    expect(mockState.setIndexerSwitches).toHaveBeenCalledWith("idx.test", switches);
  });

  it("rejects a host with a path and a bad body", async () => {
    const withPath = await app.inject({
      method: "PUT",
      url: "/api/admin/indexers/a.test%2Fapi",
      payload: switches,
    });
    expect(withPath.statusCode).toBe(400);
    const badBody = await app.inject({
      method: "PUT",
      url: "/api/admin/indexers/a.test",
      payload: { tv: "yes" },
    });
    expect(badBody.statusCode).toBe(400);
    expect(mockDb.indexerSetting.upsert).not.toHaveBeenCalled();
  });

  it("deletes the row and returns the host to the global switches", async () => {
    mockDb.indexerSetting.deleteMany.mockResolvedValue({ count: 1 });

    const res = await app.inject({ method: "DELETE", url: "/api/admin/indexers/idx.test" });

    expect(res.statusCode).toBe(200);
    expect(mockDb.indexerSetting.deleteMany).toHaveBeenCalledWith({ where: { host: "idx.test" } });
    expect(mockState.setIndexerSwitches).toHaveBeenCalledWith("idx.test", null);
  });
});
