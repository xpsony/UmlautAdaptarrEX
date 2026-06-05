import "./_setup/db";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "@/lib/auth/password";
import { buildTestApp, readSetCookie } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";

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
});

afterEach(async () => {
  await cleanDb();
});

async function seedAdminUser(): Promise<{ id: string; username: string }> {
  const { prisma } = await import("@/lib/db");
  const passwordHash = await hashPassword("correct-horse-staple");
  const user = await prisma.adminUser.create({
    data: { username: "admin", passwordHash },
  });
  return user;
}

async function seedSettingRow(): Promise<void> {
  const { prisma } = await import("@/lib/db");
  await prisma.setting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      appApiKey: "seed-app-api-key",
    },
    update: {},
  });
}

interface LoginResult {
  csrfToken: string;
  sessionCookie: string;
  csrfCookie: string;
  // The signed `_csrf` cookie set by @fastify/csrf-protection. We forward it
  // raw on subsequent requests so the plugin can verify the token.
  signedCsrfCookie: string;
}

async function login(): Promise<LoginResult> {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "correct-horse-staple" },
  });
  expect(r.statusCode).toBe(200);
  const sessionCookie = readSetCookie(r.headers["set-cookie"], "uaSession");
  const csrfCookie = readSetCookie(r.headers["set-cookie"], "ua-csrf");
  const signedCsrfCookie = readSetCookie(r.headers["set-cookie"], "_csrf");
  expect(sessionCookie).not.toBeNull();
  expect(csrfCookie).not.toBeNull();
  expect(signedCsrfCookie).not.toBeNull();
  const body = r.json() as { ok: boolean; csrf: string };
  return {
    csrfToken: body.csrf,
    sessionCookie: sessionCookie!,
    csrfCookie: csrfCookie!,
    signedCsrfCookie: signedCsrfCookie!,
  };
}

describe("POST /api/auth/login", () => {
  it("returns 401 when no admin user exists", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nope", password: "anythingatall" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("returns 401 with the wrong password", async () => {
    await seedAdminUser();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong-password" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("issues uaSession + ua-csrf + _csrf cookies on success", async () => {
    await seedAdminUser();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "correct-horse-staple" },
    });
    expect(r.statusCode).toBe(200);
    const setCookies = r.headers["set-cookie"];
    expect(readSetCookie(setCookies, "uaSession")).not.toBeNull();
    expect(readSetCookie(setCookies, "ua-csrf")).not.toBeNull();
    expect(readSetCookie(setCookies, "_csrf")).not.toBeNull();
    const body = r.json() as { ok: boolean; csrf: string };
    expect(body.ok).toBe(true);
    expect(typeof body.csrf).toBe("string");
  });

  it("persists a Session row tied to the user", async () => {
    const user = await seedAdminUser();
    await login();
    const { prisma } = await import("@/lib/db");
    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(1);
  });
});

describe("admin route protection", () => {
  it("returns 401 on a safe method without a session cookie", async () => {
    await seedAdminUser();
    await seedSettingRow();
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/settings",
    });
    expect(r.statusCode).toBe(401);
  });

  it("returns 200 on GET when the session cookie is valid (no CSRF needed)", async () => {
    await seedAdminUser();
    await seedSettingRow();
    const session = await login();
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/settings",
      cookies: { uaSession: session.sessionCookie },
    });
    expect(r.statusCode).toBe(200);
  });

  it("returns 403 csrf-invalid on PUT without the x-csrf-token header", async () => {
    await seedAdminUser();
    await seedSettingRow();
    const session = await login();
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      cookies: {
        uaSession: session.sessionCookie,
        _csrf: session.signedCsrfCookie,
      },
      payload: { cacheDurationMinutes: 24 },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: "csrf-invalid" });
  });

  it("accepts a PUT when both session cookie and matching CSRF token are sent", async () => {
    await seedAdminUser();
    await seedSettingRow();
    const session = await login();
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      cookies: {
        uaSession: session.sessionCookie,
        _csrf: session.signedCsrfCookie,
      },
      headers: { "x-csrf-token": session.csrfToken },
      payload: { cacheDurationMinutes: 24 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { cacheDurationMinutes: number };
    expect(body.cacheDurationMinutes).toBe(24);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and clears every auth cookie", async () => {
    await seedAdminUser();
    const session = await login();

    const r = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: {
        uaSession: session.sessionCookie,
        _csrf: session.signedCsrfCookie,
      },
      headers: { "x-csrf-token": session.csrfToken },
    });
    expect(r.statusCode).toBe(200);

    // Subsequent /me calls with the now-revoked cookie must come back 401.
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { uaSession: session.sessionCookie },
    });
    expect(me.statusCode).toBe(401);

    // Server-side: the session row is gone.
    const { prisma } = await import("@/lib/db");
    expect(await prisma.session.count()).toBe(0);
  });

  it("rejects a logout attempt without a session cookie (no CSRF token)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(r.statusCode).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 without a session cookie", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(r.statusCode).toBe(401);
  });

  it("returns the user info for an authenticated request", async () => {
    const user = await seedAdminUser();
    const session = await login();
    const r = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { uaSession: session.sessionCookie },
    });
    expect(r.statusCode).toBe(200);
    // A freshly seeded admin has never acknowledged the changelog.
    expect(r.json()).toEqual({
      id: user.id,
      username: "admin",
      lastSeenChangelog: null,
    });
  });
});
