import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdmin, mockSetting, mockPlugin, mockArr } = vi.hoisted(() => ({
  mockAdmin: { findFirst: vi.fn(), create: vi.fn() },
  mockSetting: { upsert: vi.fn(), findUnique: vi.fn() },
  mockPlugin: { upsert: vi.fn() },
  mockArr: { upsert: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    adminUser: mockAdmin,
    setting: mockSetting,
    plugin: mockPlugin,
    arrInstance: mockArr,
  },
}));

const { mockHash, mockCreateSession } = vi.hoisted(() => ({
  mockHash: vi.fn(),
  mockCreateSession: vi.fn(),
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: mockHash,
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...orig,
    createSession: mockCreateSession,
  };
});

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: { userAgent: "UA" },
    reloadSettings: vi.fn(),
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

const { mockInstall } = vi.hoisted(() => ({
  mockInstall: vi.fn(),
}));

vi.mock("@/arr/prowlarr", () => ({
  installUmlautProxy: mockInstall,
}));

import { handleSetupSubmit } from "@/server/routes/admin/_setup-handler";
import { storeApiKey } from "@/server/prowlarr-key-vault";
import type { SetupInput } from "@/schemas/auth";

let app: FastifyInstance;

beforeEach(async () => {
  mockAdmin.findFirst.mockReset();
  mockAdmin.create.mockReset();
  mockSetting.upsert.mockReset();
  mockSetting.findUnique.mockReset();
  mockPlugin.upsert.mockReset();
  mockArr.upsert.mockReset();
  mockHash.mockReset();
  mockCreateSession.mockReset();
  mockState.reloadSettings.mockReset();
  mockInstall.mockReset();

  app = Fastify({ logger: false });
  await app.register(cookie, { secret: "test-cookie-secret" });
  await app.register(csrfProtection, {
    sessionPlugin: "@fastify/cookie",
    cookieOpts: { path: "/", sameSite: "lax", httpOnly: true, signed: true },
  });
  app.post("/setup", async (req, reply) => {
    await handleSetupSubmit(req.body as SetupInput, req, reply);
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const validBody: SetupInput = {
  username: "admin",
  password: "supersafe",
  proxyUsername: "ua",
  proxyPassword: "anotherpw",
};

describe("handleSetupSubmit", () => {
  it("returns 409 when an admin user already exists", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockAdmin.findFirst.mockResolvedValueOnce({ id: "u1" });
    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: validBody,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: "user-already-exists" });
  });

  it("returns 409 when setupComplete=true is observed inside the submit (race re-check)", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: true });
    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: validBody,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: "setup-already-complete" });
    expect(mockAdmin.create).not.toHaveBeenCalled();
  });

  it("translates a P2002 unique-constraint violation on adminUser.create into a clean 409", async () => {
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockAdmin.findFirst.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce("hash");
    mockAdmin.create.mockRejectedValueOnce(
      Object.assign(new Error("unique constraint"), { code: "P2002" }),
    );
    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: validBody,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: "user-already-exists" });
    expect(mockSetting.upsert).not.toHaveBeenCalled();
  });

  it("returns 422 when a non-DE plugin is enabled without a TMDB key", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: {
        ...validBody,
        plugins: [{ id: "swedish-umlauts", enabled: true }],
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: "tmdb_required" });
  });

  it("happy path: hashes password, creates user, persists settings, opens session", async () => {
    mockAdmin.findFirst.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce("$argon2id$abc");
    mockAdmin.create.mockResolvedValueOnce({ id: "u1", username: "admin" });
    mockSetting.upsert.mockResolvedValueOnce({});
    mockCreateSession.mockResolvedValueOnce({
      id: "session-id",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: validBody,
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; csrf: string };
    expect(body.ok).toBe(true);
    expect(typeof body.csrf).toBe("string");

    expect(mockHash).toHaveBeenCalledWith("supersafe");
    expect(mockAdmin.create).toHaveBeenCalledOnce();
    expect(mockSetting.upsert).toHaveBeenCalledOnce();
    expect(mockState.reloadSettings).toHaveBeenCalledOnce();

    const setCookies = r.headers["set-cookie"];
    const cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
    expect(cookies.some((c) => String(c).includes("uaSession="))).toBe(true);
    expect(cookies.some((c) => String(c).includes("ua-csrf="))).toBe(true);
  });

  it("persists plugin selections when supplied", async () => {
    mockAdmin.findFirst.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce("hash");
    mockAdmin.create.mockResolvedValueOnce({ id: "u1", username: "admin" });
    mockSetting.upsert.mockResolvedValueOnce({});
    mockPlugin.upsert.mockResolvedValue({});
    mockCreateSession.mockResolvedValueOnce({
      id: "s1",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await app.inject({
      method: "POST",
      url: "/setup",
      payload: {
        ...validBody,
        tmdbApiKey: "0123456789abcdef0123456789abcdef",
        plugins: [
          { id: "german-umlauts", enabled: true },
          { id: "swedish-umlauts", enabled: false },
        ],
      },
    });

    expect(mockPlugin.upsert).toHaveBeenCalledTimes(2);
  });

  it("imports prowlarr instances, resolving vault tokens", async () => {
    mockAdmin.findFirst.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce("hash");
    mockAdmin.create.mockResolvedValueOnce({ id: "u1", username: "admin" });
    mockSetting.upsert.mockResolvedValueOnce({});
    mockArr.upsert.mockResolvedValue({});
    mockCreateSession.mockResolvedValueOnce({
      id: "s1",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const realKey = "real-sonarr-api-key-1234";
    const token = storeApiKey(realKey);

    await app.inject({
      method: "POST",
      url: "/setup",
      payload: {
        ...validBody,
        prowlarrInstances: [
          {
            type: "sonarr",
            name: "S1",
            host: "http://sonarr.local",
            apiKey: token,
            enabled: true,
            providerOrder: ["pcjones"],
          },
        ],
      },
    });

    expect(mockArr.upsert).toHaveBeenCalledOnce();
    const args = mockArr.upsert.mock.calls[0]?.[0] as {
      create: { apiKey: string };
    };
    expect(args.create.apiKey).toBe(realKey);
  });

  it("aborts with 409 stale_preview when a vault token is no longer valid", async () => {
    mockAdmin.findFirst.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce("hash");
    mockAdmin.create.mockResolvedValueOnce({ id: "u1", username: "admin" });
    mockSetting.upsert.mockResolvedValueOnce({});

    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: {
        ...validBody,
        prowlarrInstances: [
          {
            type: "sonarr",
            name: "S1",
            host: "http://sonarr.local",
            apiKey: "__ua_key:never-stored",
            enabled: true,
            providerOrder: ["pcjones"],
          },
        ],
      },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "stale_preview" });
  });

  it("attempts proxy install when installProxyInProwlarr is supplied", async () => {
    mockAdmin.findFirst.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce("hash");
    mockAdmin.create.mockResolvedValueOnce({ id: "u1", username: "admin" });
    mockSetting.upsert.mockResolvedValueOnce({});
    // First findUnique is the BUG-005 race re-check (setupComplete still
    // false), second is the prowlarr-creds lookup inside the proxy install.
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockSetting.findUnique.mockResolvedValueOnce({
      prowlarrHost: "http://prowlarr",
      prowlarrApiKey: "k",
      proxyPort: 5006,
    });
    mockInstall.mockResolvedValueOnce({ ok: true });
    mockCreateSession.mockResolvedValueOnce({
      id: "s1",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: {
        ...validBody,
        installProxyInProwlarr: { host: "self.example" },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { proxyInstall: { ok: boolean } };
    expect(body.proxyInstall.ok).toBe(true);
    expect(mockInstall).toHaveBeenCalledOnce();
  });

  it("returns no_stored_creds for proxy install when prowlarr creds are missing", async () => {
    mockAdmin.findFirst.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce("hash");
    mockAdmin.create.mockResolvedValueOnce({ id: "u1", username: "admin" });
    mockSetting.upsert.mockResolvedValueOnce({});
    // First call = BUG-005 race re-check, second call = prowlarr-creds lookup.
    mockSetting.findUnique.mockResolvedValueOnce({ setupComplete: false });
    mockSetting.findUnique.mockResolvedValueOnce(null);
    mockCreateSession.mockResolvedValueOnce({
      id: "s1",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const r = await app.inject({
      method: "POST",
      url: "/setup",
      payload: {
        ...validBody,
        installProxyInProwlarr: { host: "self.example" },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      proxyInstall: { ok: boolean; error?: string };
    };
    expect(body.proxyInstall.ok).toBe(false);
    expect(body.proxyInstall.error).toBe("no_stored_creds");
    expect(mockInstall).not.toHaveBeenCalled();
  });
});
