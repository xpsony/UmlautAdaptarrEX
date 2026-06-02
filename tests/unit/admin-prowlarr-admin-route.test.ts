import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op */
  },
}));

const { mockSetting, mockArr } = vi.hoisted(() => ({
  mockSetting: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  mockArr: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    setting: mockSetting,
    arrInstance: mockArr,
  },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: {
      userAgent: "UA",
      proxyPort: 5006,
      proxyUsername: "U",
      proxyPassword: "P",
      appApiKey: "fallback",
    },
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

const { mockFetchApps, mockFindExisting, mockInstallProxy, mockFetchIndexers, mockReconcile } =
  vi.hoisted(() => ({
    mockFetchApps: vi.fn(),
    mockFindExisting: vi.fn(),
    mockInstallProxy: vi.fn(),
    mockFetchIndexers: vi.fn(),
    mockReconcile: vi.fn(),
  }));

vi.mock("@/arr/prowlarr", () => ({
  fetchProwlarrApplications: mockFetchApps,
  findExistingUmlautProxy: mockFindExisting,
  installUmlautProxy: mockInstallProxy,
  fetchProwlarrIndexers: mockFetchIndexers,
  reconcileIndexerPatches: mockReconcile,
  PROWLARR_PROXY_NAME: "UmlautAdaptarr",
  PROWLARR_PROXY_TAG_LABEL: "umlaut-adaptarr",
}));

import { prowlarrAdminRoutes } from "@/server/routes/admin/prowlarr-admin";

let app: FastifyInstance;

beforeEach(async () => {
  mockSetting.findUnique.mockReset();
  mockSetting.update.mockReset();
  mockSetting.upsert.mockReset();
  mockArr.findUnique.mockReset();
  mockArr.upsert.mockReset();
  mockFetchApps.mockReset();
  mockFindExisting.mockReset();
  mockInstallProxy.mockReset();
  mockFetchIndexers.mockReset();
  mockReconcile.mockReset();
  mockState.settings.proxyPassword = "P";

  app = Fastify({ logger: false });
  await prowlarrAdminRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/admin/instances/prowlarr/config", () => {
  it("returns host and configured flag, hiding the api key", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "k",
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/config",
    });
    expect(r.json()).toEqual({
      host: "http://prowlarr",
      configured: true,
    });
  });

  it("returns null host and false when not configured", async () => {
    mockSetting.findUnique.mockResolvedValueOnce(null);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/config",
    });
    expect(r.json()).toEqual({ host: null, configured: false });
  });
});

describe("POST /api/admin/instances/prowlarr/test", () => {
  it("returns ok with apps and skipped counts on success", async () => {
    mockFetchApps.mockResolvedValueOnce({
      ok: true,
      apps: [{ name: "S1" }],
      skipped: [],
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/test",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "1234567890",
      },
    });
    expect(r.json()).toEqual({ ok: true, appsCount: 1, skippedCount: 0 });
  });

  it("returns ok=false with the upstream status on failure", async () => {
    mockFetchApps.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "auth",
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/test",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "1234567890",
      },
    });
    expect(r.json()).toEqual({ ok: false, status: 401, error: "auth" });
  });
});

describe("PUT /api/admin/instances/prowlarr/config", () => {
  it("persists creds after a successful upstream check", async () => {
    mockFetchApps.mockResolvedValueOnce({
      ok: true,
      apps: [],
      skipped: [],
    });
    mockSetting.upsert.mockResolvedValueOnce({});
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/instances/prowlarr/config",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "1234567890",
      },
    });
    expect(r.json()).toMatchObject({ ok: true, configured: true });
    expect(mockSetting.upsert).toHaveBeenCalledOnce();
  });

  it("returns the upstream error without persisting on failure", async () => {
    mockFetchApps.mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: "upstream",
    });
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/instances/prowlarr/config",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "1234567890",
      },
    });
    expect(r.statusCode).toBe(502);
    expect(mockSetting.upsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/instances/prowlarr/config", () => {
  it("nulls the persisted creds", async () => {
    mockSetting.update.mockResolvedValueOnce({});
    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/instances/prowlarr/config",
    });
    expect(r.json()).toEqual({ ok: true });
    expect(mockSetting.update).toHaveBeenCalledOnce();
  });
});

describe("POST /api/admin/instances/prowlarr/preview", () => {
  it("uses stored creds when useStored=true", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "k",
    });
    mockFetchApps.mockResolvedValueOnce({
      ok: true,
      apps: [{ name: "S1" }],
      skipped: [],
    });
    mockSetting.upsert.mockResolvedValueOnce({});
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/preview",
      payload: { useStored: true },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ apps: [{ name: "S1" }] });
  });

  it("returns 409 when useStored=true but no creds are stored", async () => {
    mockSetting.findUnique.mockResolvedValueOnce(null);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/preview",
      payload: { useStored: true },
    });
    expect(r.statusCode).toBe(409);
  });

  it("replaces downstream-app api keys with vault tokens (no cleartext leak)", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "k",
    });
    mockFetchApps.mockResolvedValueOnce({
      ok: true,
      apps: [
        { name: "Sonarr", apiKey: "real-sonarr-secret-1234" },
        { name: "Radarr", apiKey: "real-radarr-secret-5678" },
        { name: "NoKey" },
      ],
      skipped: [],
    });
    mockSetting.upsert.mockResolvedValueOnce({});
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/preview",
      payload: { useStored: true },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { apps: Array<{ name: string; apiKey?: string }> };
    const sonarr = body.apps.find((a) => a.name === "Sonarr");
    const radarr = body.apps.find((a) => a.name === "Radarr");
    const noKey = body.apps.find((a) => a.name === "NoKey");
    expect(sonarr?.apiKey).toMatch(/^__ua_key:/);
    expect(sonarr?.apiKey).not.toBe("real-sonarr-secret-1234");
    expect(radarr?.apiKey).toMatch(/^__ua_key:/);
    expect(noKey?.apiKey).toBeUndefined();
  });
});

describe("POST /api/admin/instances/prowlarr/import", () => {
  it("upserts each selection and counts created vs updated", async () => {
    mockArr.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "existing",
    });
    mockArr.upsert.mockResolvedValue({});

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/import",
      payload: {
        selections: [
          {
            type: "sonarr",
            name: "New",
            host: "http://x",
            apiKey: "key-1234567",
            enabled: true,
            providerOrder: ["pcjones"],
          },
          {
            type: "radarr",
            name: "Existing",
            host: "http://y",
            apiKey: "key-1234567",
            enabled: true,
            providerOrder: ["tmdb"],
          },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { created: number; updated: number };
    expect(body.created).toBe(1);
    expect(body.updated).toBe(1);
  });

  it("collects per-row errors instead of failing the whole batch", async () => {
    mockArr.findUnique.mockResolvedValueOnce(null);
    mockArr.upsert.mockRejectedValueOnce(new Error("duplicate key"));

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/import",
      payload: {
        selections: [
          {
            type: "sonarr",
            name: "X",
            host: "http://x",
            apiKey: "key-1234567",
            enabled: true,
            providerOrder: ["pcjones"],
          },
        ],
      },
    });
    const body = r.json() as { errors: Array<{ message: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.message).toMatch(/duplicate key/);
  });
});

describe("install-proxy", () => {
  it("preview returns config with hasPassword + existing", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "k",
    });
    mockFindExisting.mockResolvedValueOnce({
      ok: true,
      existing: { id: 5 },
    });

    const r = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/install-proxy/preview",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      hasPassword: boolean;
      existing: unknown;
      port: number;
    };
    expect(body.hasPassword).toBe(true);
    expect(body.existing).toEqual({ id: 5 });
    expect(body.port).toBe(5006);
  });

  it("install rejects with 409 when proxy password is empty", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "k",
    });
    mockState.settings.proxyPassword = "";
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/install-proxy",
      payload: { host: "self.example" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_proxy_password" });
  });

  it("install returns the action and ids on success", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "k",
    });
    mockInstallProxy.mockResolvedValueOnce({
      ok: true,
      action: "created",
      id: 7,
      tagId: 3,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/install-proxy",
      payload: { host: "self.example" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      ok: true,
      action: "created",
      id: 7,
      tagId: 3,
    });
  });
});

describe("GET /api/admin/instances/prowlarr/indexers", () => {
  it("returns the mapped indexers when creds are stored", async () => {
    mockSetting.findUnique.mockResolvedValue({
      id: 1,
      prowlarrHost: "https://prowlarr.test",
      prowlarrApiKey: "key12345",
    });
    mockFetchIndexers.mockResolvedValue({
      ok: true,
      indexers: [
        {
          id: 1,
          name: "Demo",
          enable: true,
          protocol: "torrent",
          currentBaseUrl: "https://demo.test",
          isPatched: false,
          patchable: true,
        },
      ],
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/indexers",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.indexers).toHaveLength(1);
    expect(body.tagLabel).toBe("umlaut-adaptarr");
  });

  it("409s when no creds are stored", async () => {
    mockSetting.findUnique.mockResolvedValue(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/indexers",
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("POST /api/admin/instances/prowlarr/indexers/patch", () => {
  it("reconciles the selection and returns per-indexer results", async () => {
    mockSetting.findUnique.mockResolvedValue({
      id: 1,
      prowlarrHost: "https://prowlarr.test",
      prowlarrApiKey: "key12345",
    });
    mockReconcile.mockResolvedValue({
      ok: true,
      results: [{ id: 1, name: "Demo", action: "patched" }],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/indexers/patch",
      payload: { selectedIds: [1] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].action).toBe("patched");
    expect(mockReconcile).toHaveBeenCalledWith(
      "https://prowlarr.test",
      "key12345",
      "UA",
      [1],
      expect.anything(),
    );
  });

  it("rejects a malformed payload", async () => {
    mockSetting.findUnique.mockResolvedValue({
      id: 1,
      prowlarrHost: "https://prowlarr.test",
      prowlarrApiKey: "key12345",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/indexers/patch",
      payload: { selectedIds: "nope" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
