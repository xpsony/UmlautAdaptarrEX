import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op */
  },
}));

const { mockSetting, mockCache } = vi.hoisted(() => ({
  mockSetting: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  mockCache: {
    count: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    setting: mockSetting,
    titleApiCache: mockCache,
  },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: { operationMode: "proxy" },
    languagePack: { activePlugins: [] },
    reloadSettings: vi.fn(),
    providerForOrder: vi.fn(),
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

const { mockProbeTmdb, mockProbeTvdb } = vi.hoisted(() => ({
  mockProbeTmdb: vi.fn(),
  mockProbeTvdb: vi.fn(),
}));

vi.mock("@/providers/tmdb", () => ({
  probeTmdbKey: mockProbeTmdb,
}));

vi.mock("@/providers/tvdb", () => ({
  probeTvdbKey: mockProbeTvdb,
}));

vi.mock("@/providers", () => ({
  requiredLanguages: () => ["de"],
}));

const { mockPick } = vi.hoisted(() => ({
  mockPick: vi.fn(),
}));

vi.mock("@/server/title-cache/recheck", () => ({
  pickMissingCandidates: mockPick,
}));

import { settingsRoutes } from "@/server/routes/admin/settings";

let app: FastifyInstance;

beforeEach(async () => {
  for (const m of [mockSetting.findUnique, mockSetting.update]) m.mockReset();
  for (const m of [mockCache.count, mockCache.deleteMany, mockCache.findMany])
    m.mockReset();
  mockProbeTmdb.mockReset();
  mockProbeTvdb.mockReset();
  mockState.reloadSettings.mockReset();
  mockState.providerForOrder.mockReset();
  mockPick.mockReset();
  mockState.settings.operationMode = "proxy";

  app = Fastify({ logger: false });
  await settingsRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/admin/settings", () => {
  it("returns settings with prowlarrConfigured but never the api key", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      id: 1,
      appApiKey: "k",
      proxyPort: 5006,
      proxyUsername: "u",
      proxyPassword: "p",
      cacheDurationMinutes: 12,
      titleApiHost: "https://x",
      tmdbApiKey: "tk",
      tvdbApiKey: null,
      tvdbPin: null,
      userAgent: "UA",
      setupComplete: true,
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "secret",
      logRetentionDays: 3,
      indexerRateLimitMs: 500,
      operationMode: "proxy",
      blockPrivateInstanceHosts: false,
    });

    const r = await app.inject({ method: "GET", url: "/api/admin/settings" });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.prowlarrConfigured).toBe(true);
    expect(body).not.toHaveProperty("prowlarrApiKey");
    // Third-party keys come back masked, never in cleartext, so a leaked
    // admin session/devtools snapshot can't exfiltrate the upstream key.
    expect(body.tmdbApiKey).toBe("••••••••");
    expect(body.tmdbConfigured).toBe(true);
    expect(body.tvdbApiKey).toBeNull();
    expect(body.tvdbConfigured).toBe(false);
  });

  it("returns null when the setting row does not exist", async () => {
    mockSetting.findUnique.mockResolvedValueOnce(null);
    const r = await app.inject({ method: "GET", url: "/api/admin/settings" });
    expect(r.json()).toBeNull();
  });
});

describe("POST /api/admin/settings/test-tmdb-key", () => {
  it("forwards the supplied api key to probeTmdbKey", async () => {
    mockProbeTmdb.mockResolvedValueOnce({ ok: true });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/settings/test-tmdb-key",
      payload: { apiKey: "abc" },
    });
    expect(r.statusCode).toBe(200);
    expect(mockProbeTmdb).toHaveBeenCalledWith("abc");
  });

  it("falls back to the stored key when none is supplied", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ tmdbApiKey: "stored" });
    mockProbeTmdb.mockResolvedValueOnce({ ok: false, code: "missing" });
    await app.inject({
      method: "POST",
      url: "/api/admin/settings/test-tmdb-key",
      payload: {},
    });
    expect(mockProbeTmdb).toHaveBeenCalledWith("stored");
  });
});

describe("POST /api/admin/settings/test-tvdb-key", () => {
  it("forwards apiKey + pin", async () => {
    mockProbeTvdb.mockResolvedValueOnce({ ok: true });
    await app.inject({
      method: "POST",
      url: "/api/admin/settings/test-tvdb-key",
      payload: { apiKey: "tk", pin: "PIN" },
    });
    expect(mockProbeTvdb).toHaveBeenCalledWith("tk", "PIN");
  });

  it("falls back to stored apiKey + pin when missing", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      tvdbApiKey: "stored-k",
      tvdbPin: "stored-pin",
    });
    mockProbeTvdb.mockResolvedValueOnce({ ok: true });
    await app.inject({
      method: "POST",
      url: "/api/admin/settings/test-tvdb-key",
      payload: {},
    });
    expect(mockProbeTvdb).toHaveBeenCalledWith("stored-k", "stored-pin");
  });
});

describe("POST /api/admin/settings/regenerate-apikey", () => {
  it("generates a new api key and persists it", async () => {
    mockSetting.update.mockResolvedValueOnce({ appApiKey: "new-key" });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-apikey",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ appApiKey: "new-key" });
    expect(mockState.reloadSettings).toHaveBeenCalledOnce();
  });
});

describe("POST /api/admin/settings/regenerate-proxy-password", () => {
  it("generates a new proxy password and persists it", async () => {
    mockSetting.update.mockResolvedValueOnce({ proxyPassword: "newpw" });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-proxy-password",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ proxyPassword: "newpw" });
  });
});

describe("title-cache routes", () => {
  it("GET returns total/positive/negative counts", async () => {
    mockCache.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/title-cache",
    });
    expect(r.json()).toEqual({ total: 10, positive: 7, negative: 2 });
  });

  it("DELETE wipes the cache", async () => {
    mockCache.deleteMany.mockResolvedValueOnce({ count: 7 });
    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/title-cache",
    });
    expect(r.json()).toEqual({ ok: true, deleted: 7 });
  });

  it("recheck-missing returns 0/0/0 when no candidates are picked", async () => {
    mockCache.findMany.mockResolvedValueOnce([]);
    mockPick.mockReturnValueOnce([]);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/title-cache/recheck-missing",
    });
    expect(r.json()).toEqual({ checked: 0, recovered: 0, stillMissing: 0 });
  });

  it("recheck-missing iterates per-type and counts recoveries", async () => {
    mockCache.findMany.mockResolvedValueOnce([]);
    mockPick.mockReturnValueOnce([
      { id: "c1", externalId: "1", type: "tv" },
      { id: "c2", externalId: "2", type: "movie" },
    ]);
    mockCache.deleteMany.mockResolvedValueOnce({ count: 2 });

    const tvProvider = {
      fetchBulk: vi
        .fn()
        .mockResolvedValueOnce(
          new Map([["1", { titlesByLang: { de: "Hit" } }]]),
        ),
    };
    const movieProvider = {
      fetchBulk: vi.fn().mockResolvedValueOnce(new Map()),
    };
    mockState.providerForOrder
      .mockReturnValueOnce(tvProvider)
      .mockReturnValueOnce(movieProvider);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/title-cache/recheck-missing",
    });
    expect(r.json()).toEqual({ checked: 2, recovered: 1, stillMissing: 1 });
  });
});
