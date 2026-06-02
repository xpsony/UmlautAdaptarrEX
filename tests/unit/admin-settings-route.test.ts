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
  delete process.env.UMLAUTADAPTARREX_PROXY_PORT;
  for (const m of [mockSetting.findUnique, mockSetting.update]) m.mockReset();
  for (const m of [mockCache.count, mockCache.deleteMany, mockCache.findMany]) m.mockReset();
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
  delete process.env.UMLAUTADAPTARREX_PROXY_PORT;
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

  it("reports proxyPortEnvManaged=false and the DB port by default", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      id: 1,
      appApiKey: "k",
      proxyPort: 5006,
      proxyUsername: "u",
      proxyPassword: "p",
      cacheDurationMinutes: 12,
      titleApiHost: "https://x",
      tmdbApiKey: null,
      tvdbApiKey: null,
      tvdbPin: null,
      userAgent: "UA",
      setupComplete: true,
      prowlarrHost: null,
      prowlarrApiKey: null,
      logRetentionDays: 3,
      indexerRateLimitMs: 500,
      operationMode: "proxy",
      blockPrivateInstanceHosts: false,
    });
    const r = await app.inject({ method: "GET", url: "/api/admin/settings" });
    const body = r.json() as Record<string, unknown>;
    expect(body.proxyPort).toBe(5006);
    expect(body.proxyPortEnvManaged).toBe(false);
  });

  it("reports the env port and proxyPortEnvManaged=true when set", async () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "6006";
    mockSetting.findUnique.mockResolvedValueOnce({
      id: 1,
      appApiKey: "k",
      proxyPort: 5006,
      proxyUsername: "u",
      proxyPassword: "p",
      cacheDurationMinutes: 12,
      titleApiHost: "https://x",
      tmdbApiKey: null,
      tvdbApiKey: null,
      tvdbPin: null,
      userAgent: "UA",
      setupComplete: true,
      prowlarrHost: null,
      prowlarrApiKey: null,
      logRetentionDays: 3,
      indexerRateLimitMs: 500,
      operationMode: "proxy",
      blockPrivateInstanceHosts: false,
    });
    const r = await app.inject({ method: "GET", url: "/api/admin/settings" });
    const body = r.json() as Record<string, unknown>;
    expect(body.proxyPort).toBe(6006);
    expect(body.proxyPortEnvManaged).toBe(true);
  });

  it("returns null when the setting row does not exist", async () => {
    mockSetting.findUnique.mockResolvedValueOnce(null);
    const r = await app.inject({ method: "GET", url: "/api/admin/settings" });
    expect(r.json()).toBeNull();
  });
});

describe("PUT /api/admin/settings", () => {
  it("updates a single secret without touching the others", async () => {
    // Regression for the providers-tab UX rework: when the operator changes
    // only the TVDB key, the PUT payload contains the new TVDB value plus
    // the masked sentinel for TMDB. The route must persist the TVDB change
    // and leave TMDB alone (zod preprocess + stripUndefined). Without this,
    // the user is forced to re-enter every key on every save.
    mockSetting.update.mockResolvedValueOnce({
      id: 1,
      appApiKey: "k",
      proxyPort: 5006,
      proxyUsername: "u",
      proxyPassword: "p",
      cacheDurationMinutes: 12,
      titleApiHost: "https://x",
      tmdbApiKey: "kept-tmdb",
      tvdbApiKey: "new-tvdb",
      tvdbPin: null,
      userAgent: "UA",
      setupComplete: true,
      prowlarrHost: null,
      prowlarrApiKey: null,
      logRetentionDays: 3,
      indexerRateLimitMs: 500,
      indexerTimeoutSeconds: 60,
      operationMode: "proxy",
      blockPrivateInstanceHosts: false,
      pausedUntil: null,
    });

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: {
        tmdbApiKey: "••••••••",
        tvdbApiKey: "new-tvdb",
        tvdbPin: "••••••••",
      },
    });
    expect(r.statusCode).toBe(200);
    const call = mockSetting.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // Load-bearing: the new TVDB key reaches Prisma while the masked TMDB
    // and PIN sentinels never appear in the update payload, so the stored
    // values for those secrets stay intact.
    expect(call.data).toMatchObject({ tvdbApiKey: "new-tvdb" });
    expect(call.data).not.toHaveProperty("tmdbApiKey");
    expect(call.data).not.toHaveProperty("tvdbPin");

    const body = r.json() as Record<string, unknown>;
    // Server never echoes the cleartext — the new TVDB key comes back masked
    // exactly like the untouched TMDB key, both flagged as configured.
    expect(body.tmdbApiKey).toBe("••••••••");
    expect(body.tvdbApiKey).toBe("••••••••");
    expect(body.tmdbConfigured).toBe(true);
    expect(body.tvdbConfigured).toBe(true);
    expect(body.tvdbPinConfigured).toBe(false);
  });

  it("treats an empty string as 'clear the stored secret'", async () => {
    // Mirror behaviour: the schema preprocess maps "" to null, which Prisma
    // writes through. This is how the operator wipes a previously stored key.
    mockSetting.update.mockResolvedValueOnce({
      id: 1,
      appApiKey: "k",
      proxyPort: 5006,
      proxyUsername: "u",
      proxyPassword: "p",
      cacheDurationMinutes: 12,
      titleApiHost: "https://x",
      tmdbApiKey: null,
      tvdbApiKey: null,
      tvdbPin: null,
      userAgent: "UA",
      setupComplete: true,
      prowlarrHost: null,
      prowlarrApiKey: null,
      logRetentionDays: 3,
      indexerRateLimitMs: 500,
      indexerTimeoutSeconds: 60,
      operationMode: "proxy",
      blockPrivateInstanceHosts: false,
      pausedUntil: null,
    });

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { tmdbApiKey: "" },
    });
    expect(r.statusCode).toBe(200);
    const call = mockSetting.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // `tmdbApiKey: null` is the load-bearing assertion: empty input must
    // wipe the stored secret. The route also writes back the other settings
    // because `SettingsSchema.partial()` keeps `.default()` semantics on
    // omitted fields. We only care that the secret reached Prisma as null
    // and that the masked-only fields stayed out.
    expect(call.data).toMatchObject({ tmdbApiKey: null });
    expect(call.data).not.toHaveProperty("tvdbApiKey");
    expect(call.data).not.toHaveProperty("tvdbPin");
  });

  it("rejects a proxyPort change when the port is env-managed", async () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "6006";
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { proxyPort: 7000 },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error?: string }).error).toBe("proxy-port-env-managed");
    expect(mockSetting.update).not.toHaveBeenCalled();
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
    mockCache.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7).mockResolvedValueOnce(2);
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
      fetchBulk: vi.fn().mockResolvedValueOnce(new Map([["1", { titlesByLang: { de: "Hit" } }]])),
    };
    const movieProvider = {
      fetchBulk: vi.fn().mockResolvedValueOnce(new Map()),
    };
    mockState.providerForOrder.mockReturnValueOnce(tvProvider).mockReturnValueOnce(movieProvider);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/title-cache/recheck-missing",
    });
    expect(r.json()).toEqual({ checked: 2, recovered: 1, stillMissing: 1 });
  });
});
