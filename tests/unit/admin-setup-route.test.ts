import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetting, mockPlugin } = vi.hoisted(() => ({
  mockSetting: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  mockPlugin: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    setting: mockSetting,
    plugin: mockPlugin,
  },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: { userAgent: "UA" },
    reloadSettings: vi.fn(),
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

const { mockProbeTmdb, mockTestConnection, mockFetchApps, mockFindExisting } = vi.hoisted(() => ({
  mockProbeTmdb: vi.fn(),
  mockTestConnection: vi.fn(),
  mockFetchApps: vi.fn(),
  mockFindExisting: vi.fn(),
}));

vi.mock("@/providers/tmdb", () => ({
  probeTmdbKey: mockProbeTmdb,
}));

vi.mock("@/arr/test-connection", () => ({
  testConnection: mockTestConnection,
}));

vi.mock("@/arr/prowlarr", () => ({
  fetchProwlarrApplications: mockFetchApps,
  findExistingUmlautProxy: mockFindExisting,
  installUmlautProxy: vi.fn(),
  PROWLARR_PROXY_NAME: "UmlautAdaptarr",
  PROWLARR_PROXY_TAG_LABEL: "umlaut-adaptarr",
}));

// Skip the real handleSetupSubmit for this route-level test; we test that
// path separately via the helper.
vi.mock("@/server/routes/admin/_setup-handler", () => ({
  handleSetupSubmit: vi.fn(async (_d, _r, reply) => {
    reply.send({ ok: true });
  }),
}));

import { setupRoutes } from "@/server/routes/admin/setup";

let app: FastifyInstance;

beforeEach(async () => {
  delete process.env.UMLAUTADAPTARREX_PROXY_PORT;
  mockSetting.findUnique.mockReset();
  mockSetting.update.mockReset();
  mockSetting.upsert.mockReset();
  mockPlugin.findMany.mockReset();
  mockProbeTmdb.mockReset();
  mockTestConnection.mockReset();
  mockFetchApps.mockReset();
  mockFindExisting.mockReset();
  mockState.reloadSettings.mockReset();

  app = Fastify({ logger: false });
  await setupRoutes(app);
  await app.ready();
});

afterEach(async () => {
  delete process.env.UMLAUTADAPTARREX_PROXY_PORT;
  await app.close();
});

describe("GET /api/auth/setup-status", () => {
  it("reflects setupComplete=false with sane defaults when no row exists", async () => {
    mockSetting.findUnique.mockResolvedValueOnce(null);
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/setup-status",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      setupComplete: boolean;
      proxyDefaults: { port: number };
    };
    expect(body.setupComplete).toBe(false);
    expect(body.proxyDefaults.port).toBe(5006);
  });

  it("reflects existing prowlarr config without leaking the api key", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      setupComplete: true,
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "secret",
      proxyPort: 5006,
      proxyUsername: "U",
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/setup-status",
    });
    const body = r.json() as {
      prowlarrConfig: { host: string; configured: boolean };
    };
    expect(body.prowlarrConfig.host).toBe("http://prowlarr");
    expect(body.prowlarrConfig.configured).toBe(true);
  });

  it("reports the env proxy port and portEnvManaged=true when set", async () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "6006";
    mockSetting.findUnique.mockResolvedValueOnce({
      setupComplete: false,
      prowlarrHost: null,
      prowlarrApiKey: null,
      proxyPort: 5006,
      proxyUsername: "U",
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/setup-status",
    });
    const body = r.json() as {
      proxyDefaults: { port: number; portEnvManaged: boolean };
    };
    expect(body.proxyDefaults.port).toBe(6006);
    expect(body.proxyDefaults.portEnvManaged).toBe(true);
  });

  it("reports portEnvManaged=false when the env var is unset", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      setupComplete: false,
      prowlarrHost: null,
      prowlarrApiKey: null,
      proxyPort: 5006,
      proxyUsername: "U",
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/setup-status",
    });
    const body = r.json() as {
      proxyDefaults: { port: number; portEnvManaged: boolean };
    };
    expect(body.proxyDefaults.port).toBe(5006);
    expect(body.proxyDefaults.portEnvManaged).toBe(false);
  });
});

describe("setup endpoints gated on setup-not-complete", () => {
  it("DELETE /api/auth/prowlarr returns 403 once setup is complete", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: true });
    const r = await app.inject({
      method: "DELETE",
      url: "/api/auth/prowlarr",
    });
    expect(r.statusCode).toBe(403);
  });

  it("POST /api/auth/test-tmdb-key returns 409 once setup is complete", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: true });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/test-tmdb-key",
      payload: { apiKey: "anything" },
    });
    expect(r.statusCode).toBe(409);
  });
});

describe("GET /api/auth/plugins", () => {
  it("returns the built-in plugin list with persisted enabled state", async () => {
    mockPlugin.findMany.mockResolvedValueOnce([]);
    const r = await app.inject({ method: "GET", url: "/api/auth/plugins" });
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json())).toBe(true);
  });
});

describe("POST /api/auth/test-tmdb-key", () => {
  it("delegates to probeTmdbKey when setup is open", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockProbeTmdb.mockResolvedValueOnce({ ok: true });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/test-tmdb-key",
      payload: { apiKey: "0123456789abcdef0123456789abcdef" },
    });
    expect(r.statusCode).toBe(200);
    expect(mockProbeTmdb).toHaveBeenCalledOnce();
  });

  it("rejects an invalid body with 400", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/test-tmdb-key",
      payload: { apiKey: 123 },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("POST /api/auth/prowlarr/test", () => {
  it("returns ok with apps and skipped counts on success", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockFetchApps.mockResolvedValueOnce({
      ok: true,
      apps: [{ name: "S1" }, { name: "S2" }],
      skipped: [{ name: "Z" }],
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/prowlarr/test",
      payload: { host: "http://prowlarr.local", apiKey: "1234567890" },
    });
    expect(r.json()).toEqual({ ok: true, appsCount: 2, skippedCount: 1 });
  });

  it("forwards the upstream failure verbatim", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockFetchApps.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "auth",
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/prowlarr/test",
      payload: { host: "http://prowlarr.local", apiKey: "1234567890" },
    });
    expect(r.json()).toEqual({ ok: false, status: 401, error: "auth" });
  });
});

describe("POST /api/auth/instances/test", () => {
  it("delegates to testConnection during setup", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockTestConnection.mockResolvedValueOnce({ ok: true, version: "4.0" });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/instances/test",
      payload: {
        type: "sonarr",
        host: "http://sonarr.local",
        apiKey: "k",
      },
    });
    expect(r.statusCode).toBe(200);
    expect(mockTestConnection).toHaveBeenCalledOnce();
  });

  it("allows a non-loopback caller to probe a private host when SSRF-strict is off (default)", async () => {
    // Default deployment shape: behind Docker NAT the operator's browser
    // arrives as a non-loopback gateway IP; with strict mode off (the
    // default) the LAN target must still be reachable during setup.
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockTestConnection.mockResolvedValueOnce({ ok: true, version: "4.0" });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/instances/test",
      remoteAddress: "192.168.178.20",
      payload: {
        type: "sonarr",
        host: "http://192.168.178.95:8989",
        apiKey: "k",
      },
    });
    expect(r.statusCode).toBe(200);
    expect(mockTestConnection).toHaveBeenCalledOnce();
  });

  it("refuses a non-loopback caller probing a private host when SSRF-strict is on", async () => {
    const settings = mockState.settings as Record<string, unknown>;
    settings.blockPrivateInstanceHosts = true;
    try {
      mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
      const r = await app.inject({
        method: "POST",
        url: "/api/auth/instances/test",
        remoteAddress: "192.168.178.20",
        payload: {
          type: "sonarr",
          host: "http://192.168.178.95:8989",
          apiKey: "k",
        },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().code).toBe("private_host_blocked");
      expect(mockTestConnection).not.toHaveBeenCalled();
    } finally {
      delete settings.blockPrivateInstanceHosts;
    }
  });
});

describe("DELETE /api/auth/prowlarr", () => {
  it("nulls the persisted creds while setup is open", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      setupComplete: false,
      prowlarrHost: "x",
    });
    mockSetting.update.mockResolvedValueOnce({});
    const r = await app.inject({
      method: "DELETE",
      url: "/api/auth/prowlarr",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });
});
