import "./_setup/db";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import { authCookies, login, seedAdminUser, sessionCookieOnly } from "./_setup/auth-helpers";
import { getAppState } from "@/server/state";
import type { IndexerFetcher } from "@/server/proxy/indexer-fetcher";

// Prove that the legacy dispatcher (which writes RequestHistory + RenameHistory
// rows) and the admin history endpoints (which read those rows) agree on the
// schema and field names. Catches drift between the writer and reader.

let app: FastifyInstance;
const fetchMock = vi.fn();
const fakeFetcher = { fetch: fetchMock } as unknown as IndexerFetcher;

const APP_API_KEY = "history-test-app-key";
const INDEXER = "indexer.example.test";

beforeAll(async () => {
  await ensureTestDb();
  await cleanDb();
  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: {
      id: 1,
      appApiKey: APP_API_KEY,
      setupComplete: true,
    },
  });
  await getAppState().reloadSettings();
  app = await buildTestApp({ legacyFetcher: fakeFetcher });
});

afterAll(async () => {
  await app.close();
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});

beforeEach(async () => {
  fetchMock.mockReset();
  // Reset between tests but leave the bootstrap Setting + admin user from
  // beforeAll alone so we don't have to re-seed every time.
  const { prisma } = await import("@/lib/db");
  await prisma.requestHistory.deleteMany({});
  await prisma.renameHistory.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.adminUser.deleteMany({});
});

async function hitLegacyCaps(): Promise<void> {
  fetchMock.mockResolvedValueOnce({
    status: 200,
    contentType: "application/xml",
    body: Buffer.from("<caps/>"),
    cacheHit: false,
  });
  const r = await app.inject({
    method: "GET",
    url: `/${APP_API_KEY}/${INDEXER}/api?t=caps`,
  });
  expect(r.statusCode).toBe(200);
}

describe("legacy → admin: request history bridge", () => {
  it("legacy caps writes a row that the admin endpoint can read back", async () => {
    await hitLegacyCaps();

    await seedAdminUser();
    const session = await login(app);
    const list = await app.inject({
      method: "GET",
      url: "/api/admin/request-history",
      ...sessionCookieOnly(session),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      items: Array<{ type: string; domain: string; status: number }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      type: "caps",
      domain: INDEXER,
      status: 200,
    });
  });

  it("filters by type", async () => {
    await hitLegacyCaps();

    // Inject a second row with a different type via direct prisma.
    const { prisma } = await import("@/lib/db");
    await prisma.requestHistory.create({
      data: {
        apiKey: "tail",
        domain: INDEXER,
        type: "tvsearch",
        status: 200,
        durationMs: 10,
        cacheHit: false,
      },
    });

    await seedAdminUser();
    const session = await login(app);

    const filtered = await app.inject({
      method: "GET",
      url: "/api/admin/request-history?type=tvsearch",
      ...sessionCookieOnly(session),
    });
    const body = filtered.json() as {
      items: Array<{ type: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]?.type).toBe("tvsearch");
  });

  it("paginates with take + skip", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.requestHistory.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        apiKey: "tail",
        domain: INDEXER,
        type: "caps",
        status: 200,
        durationMs: i,
        cacheHit: false,
      })),
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "GET",
      url: "/api/admin/request-history?take=2&skip=1",
      ...sessionCookieOnly(session),
    });
    const body = r.json() as { items: unknown[]; take: number; skip: number };
    expect(body.items).toHaveLength(2);
    expect(body.take).toBe(2);
    expect(body.skip).toBe(1);
  });

  it("clamps an absurd take to the configured maximum", async () => {
    await hitLegacyCaps();
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/request-history?take=99999",
      ...sessionCookieOnly(session),
    });
    expect((r.json() as { take: number }).take).toBe(500);
  });
});

describe("admin /stats aggregates legacy rows", () => {
  it("counts request rows and computes a cache-hit rate", async () => {
    const { prisma } = await import("@/lib/db");
    const now = new Date();
    await prisma.requestHistory.createMany({
      data: [
        {
          apiKey: "a",
          domain: INDEXER,
          type: "caps",
          status: 200,
          durationMs: 1,
          cacheHit: true,
          createdAt: now,
        },
        {
          apiKey: "a",
          domain: INDEXER,
          type: "caps",
          status: 200,
          durationMs: 1,
          cacheHit: false,
          createdAt: now,
        },
      ],
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/stats",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      summary: {
        requests24h: number;
        cacheHits24h: number;
        cacheHitRate: number;
      };
      requestsHourly: unknown[];
      renamesDaily: unknown[];
    };
    expect(body.summary.requests24h).toBe(2);
    expect(body.summary.cacheHits24h).toBe(1);
    expect(body.summary.cacheHitRate).toBe(0.5);
    // 24-hour and 14-day buckets are always present (zero-padded for empty
    // hours/days), so the UI can plot a flat line on first install.
    expect(body.requestsHourly).toHaveLength(24);
    expect(body.renamesDaily).toHaveLength(14);
  });

  it("returns cacheHitRate=0 when there are no rows at all", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/stats",
      ...sessionCookieOnly(session),
    });
    const body = r.json() as { summary: { cacheHitRate: number } };
    expect(body.summary.cacheHitRate).toBe(0);
  });
});

describe("admin /request-history search filter", () => {
  it("matches query, externalId or domain via contains across all pages", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.requestHistory.createMany({
      data: [
        {
          apiKey: "a",
          domain: INDEXER,
          type: "tvsearch",
          query: "Galaxy Wars S01",
          status: 200,
          durationMs: 5,
          cacheHit: false,
        },
        {
          apiKey: "a",
          domain: INDEXER,
          type: "tvsearch",
          query: "Hidden Valley",
          status: 200,
          durationMs: 5,
          cacheHit: false,
        },
        {
          apiKey: "a",
          domain: "other.example.test",
          type: "caps",
          query: null,
          externalId: "galaxy-123",
          status: 200,
          durationMs: 5,
          cacheHit: false,
        },
      ],
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "GET",
      url: "/api/admin/request-history?search=galaxy",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      items: Array<{ query: string | null }>;
      total: number;
    };
    // Matches "Galaxy Wars S01" (query, case-insensitive under SQLite for
    // ASCII) and "galaxy-123" (externalId), not "Hidden Valley".
    expect(body.total).toBe(2);
  });
});

describe("admin /rename-history search filter", () => {
  it("matches originalTitle OR rewrittenTitle via contains", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.renameHistory.createMany({
      data: [
        {
          originalTitle: "Realm of Ravens S01",
          rewrittenTitle: "Lied der Schwarzen Raben S01",
          mediaType: "tv",
        },
        {
          originalTitle: "Hidden Valley",
          rewrittenTitle: "Hidden Valley",
          mediaType: "tv",
        },
      ],
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "GET",
      url: "/api/admin/rename-history?search=Lied",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      items: Array<{ rewrittenTitle: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]?.rewrittenTitle).toContain("Lied");
  });
});
