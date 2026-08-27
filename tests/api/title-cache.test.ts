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

// state.providerForOrder builds a CompositeTitleProvider whose fetchBulk
// would otherwise try to actually hit the configured providers. Stub the
// underlying constructors so the recheck flow stays offline.
vi.mock("@/providers/pcjones-api", () => ({
  PcjonesApiProvider: class {
    name = "pcjones-stub";
    supportedLanguages() {
      return ["de"];
    }
    async fetchByExternalId() {
      return null;
    }
    async fetchByTitle() {
      return null;
    }
    async fetchBulk(_type: string, ids: string[]) {
      const out = new Map<string, never>();
      // The recheck test seeds rows with externalIds the test wants to "recover".
      // We honour an env hint so each test can describe what we should resolve.
      const wanted = (process.env.UA_PCJONES_RESOLVE ?? "").split(",");
      for (const id of ids) {
        if (wanted.includes(id)) {
          out.set(id, {
            titlesByLang: { de: `Recovered ${id}` },
            germanTitle: `Recovered ${id}`,
            aliases: null,
          } as never);
        }
      }
      return out;
    }
  },
}));

vi.mock("@/providers/tmdb", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/providers/tmdb")>();
  return {
    ...orig,
    TmdbProvider: class {
      name = "tmdb-stub";
      supportedLanguages() {
        return ["*"];
      }
      async fetchByExternalId() {
        return null;
      }
      async fetchByTitle() {
        return null;
      }
      async fetchBulk() {
        return new Map();
      }
    },
  };
});

vi.mock("@/providers/tvdb", () => ({
  TvdbProvider: class {
    name = "tvdb-stub";
    supportedLanguages() {
      return ["*"];
    }
    async fetchByExternalId() {
      return null;
    }
    async fetchByTitle() {
      return null;
    }
    async fetchBulk() {
      return new Map();
    }
  },
}));

import { buildTestApp } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import {
  authCookies,
  login,
  seedAdminUser,
  sessionCookieOnly,
} from "./_setup/auth-helpers";
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
  delete process.env.UA_PCJONES_RESOLVE;
  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: { id: 1, appApiKey: "k", setupComplete: true },
  });
  await getAppState().reloadSettings();
});

async function seedCacheRows(): Promise<void> {
  const { prisma } = await import("@/lib/db");
  // Positive hit: expiresAt = null, has at least one translation.
  await prisma.titleApiCache.create({
    data: {
      id: "tv:positive-1",
      expiresAt: null,
      translations: {
        create: [{ lang: "de", title: "Hit", aliasesJson: null }],
      },
    },
  });
  // Negative hit (TTL active): expiresAt in future, no useful translation.
  await prisma.titleApiCache.create({
    data: {
      id: "tv:negative-1",
      expiresAt: new Date(Date.now() + 60_000),
      translations: {
        create: [{ lang: "de", title: null, aliasesJson: null }],
      },
    },
  });
  // Stale negative hit: expiresAt in the past - still counted in `total`,
  // but excluded from the "negative still inside TTL" tally.
  await prisma.titleApiCache.create({
    data: {
      id: "tv:stale-1",
      expiresAt: new Date(Date.now() - 60_000),
      translations: {
        create: [{ lang: "de", title: null, aliasesJson: null }],
      },
    },
  });
}

describe("GET /api/admin/title-cache", () => {
  it("counts total / positive / still-active negative rows separately", async () => {
    await seedCacheRows();
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "GET",
      url: "/api/admin/title-cache",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ total: 3, positive: 1, negative: 1 });
  });

  it("returns zeros when the cache is empty", async () => {
    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/title-cache",
      ...sessionCookieOnly(session),
    });
    expect(r.json()).toEqual({ total: 0, positive: 0, negative: 0 });
  });

  it("rejects unauthenticated callers with 401", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/title-cache",
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("DELETE /api/admin/title-cache", () => {
  it("wipes every row and reports the count", async () => {
    await seedCacheRows();
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/title-cache",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, deleted: 3 });

    const { prisma } = await import("@/lib/db");
    expect(await prisma.titleApiCache.count()).toBe(0);
    // ON DELETE CASCADE on TitleTranslation cleans up children too.
    expect(await prisma.titleTranslation.count()).toBe(0);
  });

  it("requires a CSRF token (state-changing)", async () => {
    await seedCacheRows();
    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "DELETE",
      url: "/api/admin/title-cache",
      cookies: {
        uaSession: session.sessionCookie,
        _csrf: session.signedCsrfCookie,
      },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("POST /api/admin/title-cache/recheck-missing", () => {
  it("returns 0/0/0 when no rows need rechecking", async () => {
    // Only positive hit: pickMissingCandidates returns nothing for it.
    const { prisma } = await import("@/lib/db");
    await prisma.titleApiCache.create({
      data: {
        id: "tv:positive-1",
        expiresAt: null,
        translations: {
          create: [{ lang: "de", title: "Hit", aliasesJson: null }],
        },
      },
    });

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/title-cache/recheck-missing",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ checked: 0, recovered: 0, stillMissing: 0 });
  });

  it("wipes candidates, retries the provider chain, and reports recovered counts", async () => {
    const { prisma } = await import("@/lib/db");
    // A row that's a whole-row negative hit: re-fetching may find the title now.
    await prisma.titleApiCache.create({
      data: {
        id: "tv:lookup-me",
        expiresAt: new Date(Date.now() + 60_000),
        translations: {
          create: [{ lang: "de", title: null, aliasesJson: null }],
        },
      },
    });
    // Tell the stubbed pcjones provider to "discover" this title on the
    // recheck pass.
    process.env.UA_PCJONES_RESOLVE = "lookup-me";

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "POST",
      url: "/api/admin/title-cache/recheck-missing",
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      checked: number;
      recovered: number;
      stillMissing: number;
    };
    expect(body.checked).toBe(1);
    expect(body.recovered).toBe(1);
    expect(body.stillMissing).toBe(0);

    // The original row is gone (deleteMany inside the recheck), and
    // DbCachedTitleProvider re-persisted a fresh row via fetchBulk → persist.
    const fresh = await prisma.titleApiCache.findUnique({
      where: { id: "tv:lookup-me" },
    });
    expect(fresh).not.toBeNull();
  });

  it("counts entries still missing after a recheck that finds nothing", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.titleApiCache.create({
      data: {
        id: "tv:still-empty",
        expiresAt: new Date(Date.now() + 60_000),
        translations: {
          create: [{ lang: "de", title: null, aliasesJson: null }],
        },
      },
    });
    // No `UA_PCJONES_RESOLVE` set, so the stub returns an empty bulk map.

    await seedAdminUser();
    const session = await login(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/admin/title-cache/recheck-missing",
      ...authCookies(session),
    });
    const body = r.json() as {
      checked: number;
      recovered: number;
      stillMissing: number;
    };
    expect(body.checked).toBe(1);
    expect(body.recovered).toBe(0);
    expect(body.stillMissing).toBe(1);
  });
});
