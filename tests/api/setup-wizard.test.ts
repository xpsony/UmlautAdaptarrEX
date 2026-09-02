import "./_setup/db";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("@/providers/tmdb", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/providers/tmdb")>();
  return {
    ...orig,
    probeTmdbKey: vi.fn(async () => ({
      ok: true,
      sample: { id: 550, title: "Sample Movie" },
    })),
  };
});

vi.mock("@/arr/prowlarr", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/arr/prowlarr")>();
  return {
    ...orig,
    fetchProwlarrApplications: vi.fn(),
    findExistingUmlautProxy: vi.fn(),
    installUmlautProxy: vi.fn(),
  };
});

vi.mock("@/arr/test-connection", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/arr/test-connection")>();
  return {
    ...orig,
    testConnection: vi.fn(),
  };
});

import { buildTestApp, readSetCookie } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import { getAppState } from "@/server/state";
import {
  fetchProwlarrApplications,
  findExistingUmlautProxy,
  installUmlautProxy,
} from "@/arr/prowlarr";

let app: FastifyInstance;

const fetchAppsMock = fetchProwlarrApplications as unknown as ReturnType<typeof vi.fn>;
const findExistingMock = findExistingUmlautProxy as unknown as ReturnType<typeof vi.fn>;
const installProxyMock = installUmlautProxy as unknown as ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await ensureTestDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanDb();
  // In production `ensureCsrfSecret()` upserts a Setting row at first boot,
  // so the typical wizard run sees id=1 already present. We mirror that
  // here so most tests run against the realistic shape; the dedicated
  // "no Setting row" describe block below intentionally skips the seed.
  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: { id: 1, appApiKey: "bootstrap-test-key" },
  });
  await getAppState().reloadSettings();
  fetchAppsMock.mockReset();
  findExistingMock.mockReset();
  installProxyMock.mockReset();
});

const minimalSetupPayload = {
  username: "admin",
  password: "supersafe-pw",
  proxyUsername: "ua-proxy",
  proxyPassword: "another-strong-pw",
};

describe("GET /api/auth/setup-status", () => {
  it("returns setupComplete=false with default proxy values for a fresh install", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/setup-status",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      setupComplete: boolean;
      proxyDefaults: { port: number; username: string };
      prowlarrConfig: { host: string | null; configured: boolean };
    };
    expect(body.setupComplete).toBe(false);
    expect(body.proxyDefaults.port).toBe(5006);
    expect(body.prowlarrConfig.configured).toBe(false);
  });
});

describe("POST /api/auth/test-tmdb-key", () => {
  it("returns the probe result while setup is still open", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/test-tmdb-key",
      payload: { apiKey: "0123456789abcdef0123456789abcdef" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      ok: true,
      sample: { id: 550, title: "Sample Movie" },
    });
  });
});

describe("POST /api/auth/prowlarr/test", () => {
  it("forwards apps and skipped counts on success", async () => {
    fetchAppsMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ name: "Sonarr-1" }, { name: "Radarr-1" }],
      skipped: [],
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/prowlarr/test",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "1234567890abcdef",
      },
    });
    expect(r.json()).toEqual({ ok: true, appsCount: 2, skippedCount: 0 });
  });
});

describe("POST /api/auth/setup happy path", () => {
  it("creates the admin user, persists settings, opens a session, and flips setupComplete", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: minimalSetupPayload,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; csrf: string };
    expect(body.ok).toBe(true);
    expect(typeof body.csrf).toBe("string");

    const setCookies = r.headers["set-cookie"];
    expect(readSetCookie(setCookies, "uaSession")).not.toBeNull();
    expect(readSetCookie(setCookies, "ua-csrf")).not.toBeNull();
    expect(readSetCookie(setCookies, "_csrf")).not.toBeNull();

    const { prisma } = await import("@/lib/db");
    expect(await prisma.adminUser.count()).toBe(1);
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.setupComplete).toBe(true);
    expect(setting?.proxyUsername).toBe(minimalSetupPayload.proxyUsername);
    expect(setting?.appApiKey).toBeTruthy();

    // The fresh session lets the user immediately hit /me without re-login.
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: {
        uaSession: readSetCookie(setCookies, "uaSession")!,
      },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ username: "admin" });
  });

  it("flips setup-status to complete after submission", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: minimalSetupPayload,
    });
    const after = await app.inject({
      method: "GET",
      url: "/api/auth/setup-status",
    });
    expect((after.json() as { setupComplete: boolean }).setupComplete).toBe(true);
  });

  it("rejects a second setup attempt with 409 once setup is complete", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: minimalSetupPayload,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: minimalSetupPayload,
    });
    expect(r.statusCode).toBe(409);
  });

  it("rejects an invalid setup body with 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: {
        username: "x", // too short
        password: "short",
        proxyUsername: "u",
        proxyPassword: "p", // too short
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it("returns 422 when a non-German plugin is enabled but no TMDB key is provided", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: {
        ...minimalSetupPayload,
        plugins: [{ id: "swedish-umlauts", enabled: true }],
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: "tmdb_required" });
  });
});

describe("setup wizard with prowlarr + plugins", () => {
  it("persists imported instances and plugin selections atomically", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: {
        ...minimalSetupPayload,
        tmdbApiKey: "0123456789abcdef0123456789abcdef",
        plugins: [
          { id: "german-umlauts", enabled: true },
          { id: "swedish-umlauts", enabled: false },
        ],
        prowlarrInstances: [
          {
            type: "sonarr",
            name: "Living Room",
            host: "http://sonarr.local",
            apiKey: "real-sonarr-key-1234",
            enabled: true,
            providerOrder: ["pcjones", "tvdb"],
          },
          {
            type: "radarr",
            name: "Movies",
            host: "http://radarr.local",
            apiKey: "real-radarr-key-1234",
            enabled: true,
            providerOrder: ["tmdb"],
          },
        ],
      },
    });
    expect(r.statusCode).toBe(200);

    const { prisma } = await import("@/lib/db");
    const instances = await prisma.arrInstance.findMany({
      orderBy: { name: "asc" },
    });
    expect(instances).toHaveLength(2);
    expect(instances[0]?.name).toBe("Living Room");
    expect(instances[0]?.providerOrder).toBe("pcjones,tvdb");
    expect(instances[1]?.providerOrder).toBe("tmdb");

    const plugins = await prisma.plugin.findMany();
    const swedish = plugins.find((p) => p.id === "swedish-umlauts");
    expect(swedish?.enabled).toBe(false);
  });

  it("optional install-proxy step calls installUmlautProxy when supplied", async () => {
    // Seed prowlarr creds so loadSetting in maybeInstallProxyInProwlarr finds
    // them. The setup endpoint normally persists creds via /preview before
    // the user reaches the install step. The bootstrap Setting row already
    // exists from beforeEach, so update rather than create.
    const { prisma } = await import("@/lib/db");
    await prisma.setting.update({
      where: { id: 1 },
      data: {
        prowlarrHost: "http://prowlarr.local",
        prowlarrApiKey: "prowlarr-key-1234",
      },
    });
    await getAppState().reloadSettings();
    installProxyMock.mockResolvedValueOnce({ ok: true });

    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: {
        ...minimalSetupPayload,
        installProxyInProwlarr: { host: "umlautadaptarrex.local" },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { proxyInstall: { ok: boolean } };
    expect(body.proxyInstall.ok).toBe(true);
    expect(installProxyMock).toHaveBeenCalledOnce();
  });
});

// Regression: gateSetupOpen used to mix two states into the same `null`
// sentinel ("setup already complete" and "no row exists yet"). On a
// brand-new install the second case made every wizard endpoint silently
// return 200 + empty body. The fix uses a discriminated union; this
// describe block locks that behaviour in.
describe("setup wizard with no Setting row at all", () => {
  beforeEach(async () => {
    // Override the standard beforeEach that seeds a row.
    await cleanDb();
    await getAppState().reloadSettings();
  });

  it("setup-status returns sane defaults without a row", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/setup-status",
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { setupComplete: boolean };
    expect(body.setupComplete).toBe(false);
  });

  it("POST /api/auth/setup runs to completion when the gate sees no row", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: minimalSetupPayload,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; csrf: string };
    expect(body.ok).toBe(true);
    expect(typeof body.csrf).toBe("string");

    const { prisma } = await import("@/lib/db");
    expect(await prisma.adminUser.count()).toBe(1);
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.setupComplete).toBe(true);
  });

  it("DELETE /api/auth/prowlarr is a no-op success when no row exists", async () => {
    const r = await app.inject({
      method: "DELETE",
      url: "/api/auth/prowlarr",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it("install-proxy preview returns 409 no_stored_creds when no row exists", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/prowlarr/install-proxy/preview",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_stored_creds" });
  });
});

describe("POST /api/auth/setup search behaviour", () => {
  it("persists the search-behaviour choices from the wizard", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: {
        ...minimalSetupPayload,
        onDemandLookup: false,
        tvVariationSearch: true,
        movieVariationSearch: false,
        maxTitleVariations: 5,
        syncIntervalMinutes: 30,
        fullSyncIntervalHours: 12,
      },
    });
    expect(r.statusCode).toBe(200);

    const { prisma } = await import("@/lib/db");
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.onDemandLookup).toBe(false);
    expect(setting?.tvVariationSearch).toBe(true);
    expect(setting?.movieVariationSearch).toBe(false);
    expect(setting?.maxTitleVariations).toBe(5);
    expect(setting?.syncIntervalMinutes).toBe(30);
    expect(setting?.fullSyncIntervalHours).toBe(12);
  });

  it("falls back to the recommended defaults when the wizard omits them", async () => {
    // An older client that predates the `search` step must not land on the
    // existing-install pin; it gets the recommended values, same policy as
    // operationMode.
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: minimalSetupPayload,
    });
    expect(r.statusCode).toBe(200);

    const { prisma } = await import("@/lib/db");
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.onDemandLookup).toBe(true);
    expect(setting?.tvVariationSearch).toBe(true);
    expect(setting?.movieVariationSearch).toBe(true);
    expect(setting?.maxTitleVariations).toBe(1);
    expect(setting?.syncIntervalMinutes).toBe(10);
    expect(setting?.fullSyncIntervalHours).toBe(24);
  });

  it("rejects a variation cap outside the allowed range", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { ...minimalSetupPayload, maxTitleVariations: 99 },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rejects a quick-sync interval between one and four minutes", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { ...minimalSetupPayload, syncIntervalMinutes: 3 },
    });
    expect(r.statusCode).toBe(400);
  });
});
