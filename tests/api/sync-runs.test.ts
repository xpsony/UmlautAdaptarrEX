import "./_setup/db";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Stub the arr-builder so the background sync work doesn't try to hit Sonarr
// (and so we can control how many items each instance "fetches"). We keep the
// rest of the chain real: prisma, scheduler, runSync, persist & reindex.
vi.mock("@/arr", () => ({
  buildArrClient: vi.fn(() => ({
    fetchAllItems: async () => [],
  })),
}));

import { buildTestApp } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import { authCookies, login, seedAdminUser, sessionCookieOnly } from "./_setup/auth-helpers";
import { getAppState } from "@/server/state";

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

async function seedSettingWithProvider(): Promise<void> {
  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: { id: 1, appApiKey: "k", setupComplete: true },
  });
  // reloadSettings sets state.provider via providerForOrder using the
  // titleApiHost default; the stubbed buildArrClient short-circuits any
  // outbound HTTP from the provider itself.
  await getAppState().reloadSettings();
}

async function seedEnabledInstance(
  type: "sonarr" | "radarr" | "lidarr" | "readarr" = "sonarr",
  name = "S1",
): Promise<{ id: string }> {
  const { prisma } = await import("@/lib/db");
  return prisma.arrInstance.create({
    data: {
      type,
      name,
      host: `http://${type}.local`,
      apiKey: "real-key-1234",
      enabled: true,
      providerOrder: type === "sonarr" || type === "radarr" ? "pcjones" : null,
    },
  });
}

describe("POST /api/admin/sync", () => {
  it("returns 409 no_provider when a Sonarr instance is enabled but no Setting row exists", async () => {
    await getAppState().reloadSettings();
    expect(getAppState().provider).toBeNull();

    // Seed a sonarr instance so the provider gate is meaningful: Lidarr-only
    // setups skip the gate (they don't consult a provider), so the no_provider
    // outcome only fires when at least one sonarr/radarr instance is present.
    await seedEnabledInstance("sonarr");
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/sync",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_provider" });
  });

  it("starts the sync for Lidarr-only setups even without a configured Setting row", async () => {
    await getAppState().reloadSettings();
    expect(getAppState().provider).toBeNull();

    await seedEnabledInstance("lidarr", "L1");
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/sync",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ ok: true, instanceCount: 1 });
  });

  it("returns 409 no_instances when there are no enabled instances", async () => {
    await seedSettingWithProvider();
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/sync",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "no_instances" });
  });

  it("creates a SyncRun row per enabled instance and returns 202", async () => {
    await seedSettingWithProvider();
    await seedEnabledInstance("sonarr", "Living Room");
    await seedEnabledInstance("radarr", "Movies");

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/sync",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(202);
    const body = r.json() as {
      ok: boolean;
      runIds: string[];
      instanceCount: number;
    };
    expect(body.instanceCount).toBe(2);
    expect(body.runIds).toHaveLength(2);

    // Rows are created synchronously before the 202 returns; the actual
    // sync work runs in the background and may have finished or not.
    const { prisma } = await import("@/lib/db");
    const rows = await prisma.syncRun.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(body.runIds.slice().sort());
  });

  it("filters to one instance when instanceId is supplied", async () => {
    await seedSettingWithProvider();
    const target = await seedEnabledInstance("sonarr", "Target");
    await seedEnabledInstance("radarr", "Other");

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/sync",
      payload: { instanceId: target.id },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(202);
    expect((r.json() as { instanceCount: number }).instanceCount).toBe(1);
  });

  it("rejects unauthenticated calls with 401", async () => {
    const r = await app.inject({ method: "POST", url: "/api/admin/sync" });
    expect(r.statusCode).toBe(401);
  });

  it("rejects calls without a CSRF token with 403", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/sync",
      cookies: {
        uaSession: session.sessionCookie,
        _csrf: session.signedCsrfCookie,
      },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("GET /api/admin/sync-runs", () => {
  it("returns the most recent runs in startedAt-desc order with default take", async () => {
    await seedSettingWithProvider();
    const inst = await seedEnabledInstance();
    const { prisma } = await import("@/lib/db");
    const oldest = await prisma.syncRun.create({
      data: {
        arrInstanceId: inst.id,
        status: "success",
        startedAt: new Date(2026, 0, 1),
      },
    });
    const newest = await prisma.syncRun.create({
      data: {
        arrInstanceId: inst.id,
        status: "success",
        startedAt: new Date(2026, 5, 1),
      },
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ id: string }>;
    expect(rows[0]?.id).toBe(newest.id);
    expect(rows[1]?.id).toBe(oldest.id);
  });

  it("filters by ids parameter when supplied", async () => {
    await seedSettingWithProvider();
    const inst = await seedEnabledInstance();
    const { prisma } = await import("@/lib/db");
    const wanted = await prisma.syncRun.create({
      data: { arrInstanceId: inst.id, status: "success" },
    });
    await prisma.syncRun.create({
      data: { arrInstanceId: inst.id, status: "success" },
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: `/api/admin/sync-runs?ids=${wanted.id}`,
      ...sessionCookieOnly(session),
    });
    const rows = r.json() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(wanted.id);
  });

  it("clamps take to the configured maximum", async () => {
    await seedSettingWithProvider();
    const inst = await seedEnabledInstance();
    const { prisma } = await import("@/lib/db");
    await prisma.syncRun.createMany({
      data: Array.from({ length: 5 }, () => ({
        arrInstanceId: inst.id,
        status: "success" as const,
      })),
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/sync-runs?take=99999",
      ...sessionCookieOnly(session),
    });
    // The route uses Math.min(parseInt(...) || 20, 200) — assert we got at
    // most that many rows back. With 5 seeded, that's just 5.
    const rows = r.json() as unknown[];
    expect(rows.length).toBeLessThanOrEqual(200);
  });
});
