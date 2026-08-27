import "./_setup/db";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import { authCookies, login, seedAdminUser, sessionCookieOnly } from "./_setup/auth-helpers";
import { getAppState } from "@/server/state";

let app: FastifyInstance;

const INITIAL_API_KEY = "initial-app-api-key-for-regen-test";
const INITIAL_PROXY_PW = "initial-proxy-password-for-regen-test";

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
  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: {
      id: 1,
      appApiKey: INITIAL_API_KEY,
      proxyPassword: INITIAL_PROXY_PW,
      setupComplete: true,
    },
  });
  await getAppState().reloadSettings();
});

describe("POST /api/admin/settings/regenerate-apikey", () => {
  it("returns a new key, persists it, and reloads state", async () => {
    expect(getAppState().settings.appApiKey).toBe(INITIAL_API_KEY);

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-apikey",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { appApiKey: string };
    expect(typeof body.appApiKey).toBe("string");
    expect(body.appApiKey).not.toBe(INITIAL_API_KEY);
    expect(body.appApiKey.length).toBeGreaterThanOrEqual(16);

    // DB persistence.
    const { prisma } = await import("@/lib/db");
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.appApiKey).toBe(body.appApiKey);

    // Live state was reloaded - legacy /:apiKey/* uses this for auth.
    expect(getAppState().settings.appApiKey).toBe(body.appApiKey);
  });

  it("rejects unauthenticated POST with 401", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-apikey",
    });
    expect(r.statusCode).toBe(401);
  });

  it("rejects POST without a CSRF token with 403", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-apikey",
      cookies: {
        uaSession: session.sessionCookie,
        _csrf: session.signedCsrfCookie,
      },
    });
    expect(r.statusCode).toBe(403);
  });

  it("two consecutive regenerations produce different keys", async () => {
    await seedAdminUser();
    const session = await login(app);

    const a = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-apikey",
      ...authCookies(session),
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-apikey",
      ...authCookies(session),
    });
    expect((a.json() as { appApiKey: string }).appApiKey).not.toBe(
      (b.json() as { appApiKey: string }).appApiKey,
    );
  });
});

describe("POST /api/admin/settings/regenerate-proxy-password", () => {
  it("returns a new password and persists it", async () => {
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/settings/regenerate-proxy-password",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { proxyPassword: string };
    expect(typeof body.proxyPassword).toBe("string");
    expect(body.proxyPassword).not.toBe(INITIAL_PROXY_PW);

    const { prisma } = await import("@/lib/db");
    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    expect(setting?.proxyPassword).toBe(body.proxyPassword);
    expect(getAppState().settings.proxyPassword).toBe(body.proxyPassword);
  });
});

describe("GET /api/admin/settings server-side secret hiding", () => {
  it("never returns prowlarrApiKey or csrfSecret in the wire response", async () => {
    // Seed both secrets so we can prove they leak only via `prowlarrConfigured`
    // and not as raw values.
    const { prisma } = await import("@/lib/db");
    await prisma.setting.update({
      where: { id: 1 },
      data: {
        prowlarrHost: "http://prowlarr.local",
        prowlarrApiKey: "this-must-never-leak",
        csrfSecret: "secret-binary-data-here-also-secret",
      },
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/settings",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;

    expect(body).not.toHaveProperty("prowlarrApiKey");
    expect(body).not.toHaveProperty("csrfSecret");
    expect(body.prowlarrConfigured).toBe(true);
    // Defensive check on the raw response body too in case a future
    // refactor accidentally inlines the value somewhere.
    expect(JSON.stringify(body)).not.toContain("this-must-never-leak");
    expect(JSON.stringify(body)).not.toContain("secret-binary-data");
  });
});

describe("PUT /api/admin/settings live-reload", () => {
  it("updates state.settings synchronously after the response", async () => {
    expect(getAppState().settings.cacheDurationMinutes).toBeDefined();
    const before = getAppState().settings.cacheDurationMinutes;

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { cacheDurationMinutes: before + 5 },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(getAppState().settings.cacheDurationMinutes).toBe(before + 5);
  });

  it("round-trips the renaming toggles into state.renameOptions", async () => {
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: {
        renameYearGuard: false,
        renamePrefixGuard: false,
        renameReleaseTagGuard: false,
        renameLegacySuffix: true,
        renameStripSpecialChars: true,
        renameAttachExternalIds: true,
      },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);

    // The getter the legacy search route reads per response.
    expect(getAppState().renameOptions).toEqual({
      yearGuard: false,
      prefixGuard: false,
      releaseTagGuard: false,
      legacySuffix: true,
      stripSpecialChars: true,
    });
    // attachExternalIds is read straight off the settings snapshot.
    expect(getAppState().settings.renameAttachExternalIds).toBe(true);

    // ...and the GET echoes them so the Renaming tab can hydrate its form.
    const get = await app.inject({
      method: "GET",
      url: "/api/admin/settings",
      cookies: { uaSession: session.sessionCookie },
    });
    expect(get.json()).toMatchObject({
      renameYearGuard: false,
      renameLegacySuffix: true,
      renameStripSpecialChars: true,
      renameAttachExternalIds: true,
    });
  });

  it("an empty userAgent override resolves to the versioned default", async () => {
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { userAgent: "" },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);

    const { defaultUserAgent } = await import("@/lib/user-agent");
    // `settings.userAgent` is the EFFECTIVE value every outbound caller reads.
    expect(getAppState().settings.userAgent).toBe(defaultUserAgent());
    expect(getAppState().settings.userAgentOverride).toBe("");
    // The GET echoes the raw override plus the automatic value, so the form
    // can render it as a placeholder.
    const get = await app.inject({
      method: "GET",
      url: "/api/admin/settings",
      cookies: { uaSession: session.sessionCookie },
    });
    expect(get.json()).toMatchObject({
      userAgent: "",
      defaultUserAgent: defaultUserAgent(),
    });
  });

  it("keeps a userAgent override and the forwarding toggle", async () => {
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { userAgent: "MyProxy/9.9", forwardArrUserAgent: true },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(getAppState().settings.userAgent).toBe("MyProxy/9.9");
    expect(getAppState().settings.forwardArrUserAgent).toBe(true);
  });

  it("an operationMode change triggers a warn-log hint without breaking the response", async () => {
    await seedAdminUser();
    const session = await login(app);

    // Default operationMode is "proxy" (from the schema default & wizard
    // fallback). Switching to "legacy" is a real behavioral change.
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { operationMode: "legacy" },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(getAppState().settings.operationMode).toBe("legacy");
  });
});
