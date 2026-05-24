import "./_setup/db";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("@/arr/prowlarr", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/arr/prowlarr")>();
  return {
    ...orig,
    fetchProwlarrApplications: vi.fn(),
    findExistingUmlautProxy: vi.fn(),
    installUmlautProxy: vi.fn(),
  };
});

import { buildTestApp } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import {
  authCookies,
  login,
  seedAdminUser,
  sessionCookieOnly,
} from "./_setup/auth-helpers";
import { getAppState } from "@/server/state";
import {
  fetchProwlarrApplications,
  findExistingUmlautProxy,
  installUmlautProxy,
} from "@/arr/prowlarr";

const fetchAppsMock = fetchProwlarrApplications as unknown as ReturnType<
  typeof vi.fn
>;
const findExistingMock = findExistingUmlautProxy as unknown as ReturnType<
  typeof vi.fn
>;
const installProxyMock = installUmlautProxy as unknown as ReturnType<
  typeof vi.fn
>;

let app: FastifyInstance;

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
  fetchAppsMock.mockReset();
  findExistingMock.mockReset();
  installProxyMock.mockReset();
  // Bootstrap row + admin user are required for every flow below.
  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: {
      id: 1,
      appApiKey: "bootstrap-key",
      proxyPassword: "proxy-password-1234",
      setupComplete: true,
    },
  });
  await getAppState().reloadSettings();
});

describe("GET /api/admin/instances/prowlarr/config", () => {
  it("reports unconfigured when neither host nor key is stored", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/config",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ host: null, configured: false });
  });

  it("reports configured=true after a successful PUT, without leaking the api key", async () => {
    fetchAppsMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ name: "Sonarr-1" }],
      skipped: [],
    });

    await seedAdminUser();
    const session = await login(app);

    const put = await app.inject({
      method: "PUT",
      url: "/api/admin/instances/prowlarr/config",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "my-prowlarr-key-1234",
      },
      ...authCookies(session),
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/config",
      ...sessionCookieOnly(session),
    });
    const body = get.json() as Record<string, unknown>;
    expect(body).toEqual({
      host: "http://prowlarr.local",
      configured: true,
    });
    expect(JSON.stringify(body)).not.toContain("my-prowlarr-key");
  });
});

describe("PUT /api/admin/instances/prowlarr/config", () => {
  it("persists creds only after the upstream check succeeds", async () => {
    fetchAppsMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "auth",
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/instances/prowlarr/config",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "wrong-key-12345",
      },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(401);

    const { prisma } = await import("@/lib/db");
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.prowlarrHost).toBeNull();
    expect(setting?.prowlarrApiKey).toBeNull();
  });

  it("returns the apps and skipped counts on success", async () => {
    fetchAppsMock.mockResolvedValueOnce({
      ok: true,
      apps: [{ name: "Sonarr" }, { name: "Radarr" }],
      skipped: [{ name: "Whisparr" }],
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/instances/prowlarr/config",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "valid-key-1234",
      },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      ok: true,
      configured: true,
      appsCount: 2,
      skippedCount: 1,
    });
  });
});

describe("DELETE /api/admin/instances/prowlarr/config", () => {
  it("nulls out the persisted creds without removing the rest of Setting", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.setting.update({
      where: { id: 1 },
      data: {
        prowlarrHost: "http://prowlarr.local",
        prowlarrApiKey: "secret-key-1234",
      },
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/instances/prowlarr/config",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });

    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.prowlarrHost).toBeNull();
    expect(setting?.prowlarrApiKey).toBeNull();
    // Other fields preserved.
    expect(setting?.appApiKey).toBe("bootstrap-key");
  });
});

describe("POST /api/admin/instances/prowlarr/preview", () => {
  it("returns apps with vault-token apiKeys (admin route, no cleartext in response)", async () => {
    fetchAppsMock.mockResolvedValueOnce({
      ok: true,
      apps: [
        {
          prowlarrId: 1,
          type: "sonarr",
          name: "Sonarr",
          host: "http://sonarr.local",
          apiKey: "raw-sonarr-key-1234",
          syncLevel: "fullSync",
        },
      ],
      skipped: [],
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/preview",
      payload: {
        host: "http://prowlarr.local",
        apiKey: "valid-key-1234",
      },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { apps: Array<{ apiKey: string }> };
    // The admin /preview route vault-tokenises downstream-app keys so a
    // leaked browser snapshot (devtools, history, screenshots) can't
    // exfiltrate every third-party API key the operator has configured.
    // The import route resolves the token back at submission time.
    const returnedKey = body.apps[0]?.apiKey ?? "";
    expect(returnedKey.startsWith("__ua_key:")).toBe(true);
    expect(returnedKey).not.toBe("raw-sonarr-key-1234");
    expect(returnedKey).not.toContain("raw-sonarr-key");
  });

  it("uses stored creds when useStored=true", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.setting.update({
      where: { id: 1 },
      data: {
        prowlarrHost: "http://prowlarr.local",
        prowlarrApiKey: "stored-key-1234",
      },
    });
    fetchAppsMock.mockResolvedValueOnce({
      ok: true,
      apps: [],
      skipped: [],
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/preview",
      payload: { useStored: true },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(fetchAppsMock).toHaveBeenCalledOnce();
    const args = fetchAppsMock.mock.calls[0] as [
      string,
      string,
      string,
      unknown,
    ];
    expect(args[0]).toBe("http://prowlarr.local");
    expect(args[1]).toBe("stored-key-1234");
  });

  it("returns 409 when useStored=true but no creds are stored", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/preview",
      payload: { useStored: true },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_stored_creds" });
  });
});

describe("POST /api/admin/instances/prowlarr/import", () => {
  it("creates new ArrInstance rows via real upsert", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/import",
      payload: {
        selections: [
          {
            type: "sonarr",
            name: "Living Room",
            host: "http://sonarr.local",
            apiKey: "real-sonarr-key-1234",
            enabled: true,
            providerOrder: ["pcjones", "tvdb"],
          },
        ],
      },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ created: 1, updated: 0, errors: [] });

    const { prisma } = await import("@/lib/db");
    const rows = await prisma.arrInstance.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerOrder).toBe("pcjones,tvdb");
  });

  it("updates an existing instance with the same (type, name)", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.arrInstance.create({
      data: {
        type: "sonarr",
        name: "Living Room",
        host: "http://old.local",
        apiKey: "old-key-1234",
      },
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/import",
      payload: {
        selections: [
          {
            type: "sonarr",
            name: "Living Room",
            host: "http://new.local",
            apiKey: "new-key-1234",
            enabled: true,
            providerOrder: ["pcjones"],
          },
        ],
      },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ created: 0, updated: 1 });

    const fresh = await prisma.arrInstance.findFirst();
    expect(fresh?.host).toBe("http://new.local");
    expect(fresh?.apiKey).toBe("new-key-1234");
  });
});

describe("install-proxy in Prowlarr", () => {
  it("preview returns 409 no_stored_creds when prowlarr config is empty", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/install-proxy/preview",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(409);
  });

  it("preview returns config + existing-probe result on success", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.setting.update({
      where: { id: 1 },
      data: {
        prowlarrHost: "http://prowlarr.local",
        prowlarrApiKey: "stored-key-1234",
      },
    });
    findExistingMock.mockResolvedValueOnce({
      ok: true,
      existing: { id: 7 },
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/instances/prowlarr/install-proxy/preview",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { hasPassword: boolean; existing: unknown };
    expect(body.hasPassword).toBe(true);
    expect(body.existing).toEqual({ id: 7 });
  });

  it("install rejects with 409 when local proxy password is empty", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.setting.update({
      where: { id: 1 },
      data: {
        prowlarrHost: "http://prowlarr.local",
        prowlarrApiKey: "stored-key-1234",
        proxyPassword: "",
      },
    });
    await getAppState().reloadSettings();

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/instances/prowlarr/install-proxy",
      payload: { host: "self.local" },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_proxy_password" });
  });
});
