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
  mockState: { settings: { userAgent: "UA" }, setIndexerSetting: vi.fn() },
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
    mockState.setIndexerSetting,
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

const setting = {
  tv: true,
  movie: false,
  audio: true,
  book: false,
  tvMax: 2,
  movieMax: 1,
  audioMax: 0,
  bookMax: 1,
};

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
    mockDb.indexerSetting.upsert.mockResolvedValue({ host: "idx.test", ...setting });

    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/indexers/IDX.test",
      payload: setting,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.indexerSetting.upsert).toHaveBeenCalledWith({
      where: { host: "idx.test" },
      create: { host: "idx.test", ...setting },
      update: setting,
    });
    expect(mockState.setIndexerSetting).toHaveBeenCalledWith("idx.test", setting);
  });

  it("rejects a cap outside 0-20 and a body without caps", async () => {
    const tooHigh = await app.inject({
      method: "PUT",
      url: "/api/admin/indexers/a.test",
      payload: { ...setting, tvMax: 21 },
    });
    expect(tooHigh.statusCode).toBe(400);
    const noCaps = await app.inject({
      method: "PUT",
      url: "/api/admin/indexers/a.test",
      payload: { tv: true, movie: false, audio: true, book: false },
    });
    expect(noCaps.statusCode).toBe(400);
    expect(mockDb.indexerSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejects a host with a path and a bad body", async () => {
    const withPath = await app.inject({
      method: "PUT",
      url: "/api/admin/indexers/a.test%2Fapi",
      payload: setting,
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
    expect(mockState.setIndexerSetting).toHaveBeenCalledWith("idx.test", null);
  });
});
