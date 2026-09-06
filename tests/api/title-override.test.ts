import "./_setup/db";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import { authCookies, login, seedAdminUser, type AuthSession } from "./_setup/auth-helpers";
import { getAppState } from "@/server/state";
import type { IndexerFetcher } from "@/server/proxy/indexer-fetcher";

// End-to-end check of the manual title override ("Overwrite") against a real
// SQLite, covering the whole chain rather than a mocked slice of it:
//
//   PUT /api/admin/title-overrides
//     -> TitleOverride upsert
//     -> rebuildSearchItemsFor  (re-derives variations via the real domain)
//     -> SearchItem rows updated in the DB
//     -> AppState.reindexInstance  (in-memory index refreshed)
//     -> legacy search now QUERIES the overridden German title
//     -> and REWRITES a release carrying it
//   DELETE ... -> back to the cached provider title
//
// The existing unit tests cover the route and the rebuild helper with mocked
// Prisma; what they cannot show is that the override actually reaches the
// outbound indexer query and the response rewrite.

let app: FastifyInstance;
let session: AuthSession;
const fetchMock = vi.fn();
const fakeFetcher = { fetch: fetchMock } as unknown as IndexerFetcher;

const APP_API_KEY = "title-override-test-key";
const INDEXER = "indexer.example.test";
const INSTANCE_ID = "inst-override";
const EXTERNAL_ID = "900042";

const PROVIDER_DE_TITLE = "Lied der Schwarzen Raben";
const OVERRIDE_DE_TITLE = "Der Rabengesang";

const RELEASE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TestIndexer</title>
    <item>
      <title>Der.Rabengesang.S01E01.GERMAN</title>
      <category>5000</category>
    </item>
  </channel>
</rss>`;

beforeAll(async () => {
  await ensureTestDb();
  app = await buildTestApp({ legacyFetcher: fakeFetcher });
});

afterAll(async () => {
  await app.close();
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanDb();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    status: 200,
    contentType: "application/xml",
    body: Buffer.from(RELEASE_FIXTURE),
    cacheHit: false,
  });

  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: {
      id: 1,
      appApiKey: APP_API_KEY,
      operationMode: "legacy",
      setupComplete: true,
    },
  });
  await prisma.arrInstance.create({
    data: {
      id: INSTANCE_ID,
      type: "sonarr",
      name: "Sonarr Test",
      host: "http://sonarr.test:8989",
      apiKey: "sonarr-key",
    },
  });
  // A synced item as the sync would have left it: German title from the
  // provider, plus the cache row the rebuild reads to restore it on delete.
  await prisma.searchItem.create({
    data: {
      id: "override-item",
      arrInstanceId: INSTANCE_ID,
      arrId: 1,
      externalId: EXTERNAL_ID,
      title: "Realm of Ravens",
      expectedTitle: "Realm of Ravens",
      germanTitle: PROVIDER_DE_TITLE,
      mediaType: "tv",
      titleSearchVariations: JSON.stringify([PROVIDER_DE_TITLE]),
      titleMatchVariations: JSON.stringify(["Realm of Ravens", PROVIDER_DE_TITLE]),
      authorMatchVariations: "[]",
    },
  });
  await prisma.titleApiCache.create({
    data: {
      id: `tv:${EXTERNAL_ID}`,
      translations: {
        create: [{ id: `tv:${EXTERNAL_ID}:de`, lang: "de", title: PROVIDER_DE_TITLE }],
      },
    },
  });

  await getAppState().reloadSettings();
  await getAppState().loadInstanceOptions();
  await getAppState().loadSearchItemsFromDb();

  await seedAdminUser();
  session = await login(app);
});

async function putOverride(germanTitle: string) {
  return app.inject({
    method: "PUT",
    url: "/api/admin/title-overrides",
    payload: { mediaType: "tv", externalId: EXTERNAL_ID, germanTitle },
    ...authCookies(session),
  });
}

async function search(): Promise<string> {
  const r = await app.inject({
    method: "GET",
    url: `/${APP_API_KEY}/${INDEXER}/api?t=tvsearch&tvdbid=${EXTERNAL_ID}&q=Realm+of+Ravens`,
  });
  expect(r.statusCode).toBe(200);
  return r.body;
}

function queriedTitles(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

describe("title override: PUT", () => {
  it("persists the override and rebuilds the SearchItem rows", async () => {
    const r = await putOverride(OVERRIDE_DE_TITLE);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ rebuiltItems: 1 });

    const { prisma } = await import("@/lib/db");
    const stored = await prisma.titleOverride.findUnique({
      where: { mediaType_externalId: { mediaType: "tv", externalId: EXTERNAL_ID } },
    });
    expect(stored?.germanTitle).toBe(OVERRIDE_DE_TITLE);

    const row = await prisma.searchItem.findUniqueOrThrow({ where: { id: "override-item" } });
    expect(row.germanTitle).toBe(OVERRIDE_DE_TITLE);
    const searchVariations = JSON.parse(row.titleSearchVariations) as string[];
    expect(searchVariations).toContain(OVERRIDE_DE_TITLE);
    // The provider title must be gone from the search variations, otherwise
    // the override would only be additive instead of replacing.
    expect(searchVariations).not.toContain(PROVIDER_DE_TITLE);
  });

  it("refreshes the in-memory index so the override is searchable immediately", async () => {
    await putOverride(OVERRIDE_DE_TITLE);
    const cached = getAppState().getByExternalId("tv", EXTERNAL_ID);
    expect(cached?.germanTitle).toBe(OVERRIDE_DE_TITLE);
    expect(cached?.titleSearchVariations).toContain(OVERRIDE_DE_TITLE);
  });

  it("makes the legacy search query the overridden title", async () => {
    await putOverride(OVERRIDE_DE_TITLE);
    await search();
    const urls = queriedTitles();
    expect(urls.some((u) => u.includes("Der+Rabengesang"))).toBe(true);
    expect(urls.some((u) => u.includes("Lied+der+Schwarzen+Raben"))).toBe(false);
  });

  it("makes the rewrite recognise a release named after the override", async () => {
    await putOverride(OVERRIDE_DE_TITLE);
    const body = await search();
    expect(body).toContain("Realm.of.Ravens.S01E01");
    expect(body).not.toContain("Der.Rabengesang.S01E01");

    const { prisma } = await import("@/lib/db");
    const renames = await prisma.renameHistory.findMany();
    expect(renames.some((r) => r.originalTitle.includes("Der.Rabengesang"))).toBe(true);
  });

  it("is idempotent: saving the same override twice keeps one row", async () => {
    await putOverride(OVERRIDE_DE_TITLE);
    const second = await putOverride(OVERRIDE_DE_TITLE);
    expect(second.statusCode).toBe(200);
    const { prisma } = await import("@/lib/db");
    expect(await prisma.titleOverride.count()).toBe(1);
  });

  it("a second override replaces the first", async () => {
    await putOverride(OVERRIDE_DE_TITLE);
    await putOverride("Ein anderer Titel");
    const cached = getAppState().getByExternalId("tv", EXTERNAL_ID);
    expect(cached?.germanTitle).toBe("Ein anderer Titel");
    expect(cached?.titleSearchVariations).not.toContain(OVERRIDE_DE_TITLE);
  });

  it("rejects an unknown item instead of creating an orphan row", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/title-overrides",
      payload: { mediaType: "tv", externalId: "999999", germanTitle: "Irgendwas" },
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(404);
    const { prisma } = await import("@/lib/db");
    expect(await prisma.titleOverride.count()).toBe(0);
  });

  it("requires authentication", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/admin/title-overrides",
      payload: { mediaType: "tv", externalId: EXTERNAL_ID, germanTitle: "X" },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("title override: DELETE", () => {
  it("restores the cached provider title everywhere", async () => {
    await putOverride(OVERRIDE_DE_TITLE);
    const r = await app.inject({
      method: "DELETE",
      url: `/api/admin/title-overrides/tv/${EXTERNAL_ID}`,
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, rebuiltItems: 1 });

    const { prisma } = await import("@/lib/db");
    const row = await prisma.searchItem.findUniqueOrThrow({ where: { id: "override-item" } });
    expect(row.germanTitle).toBe(PROVIDER_DE_TITLE);

    const cached = getAppState().getByExternalId("tv", EXTERNAL_ID);
    expect(cached?.germanTitle).toBe(PROVIDER_DE_TITLE);
    expect(cached?.titleSearchVariations).toContain(PROVIDER_DE_TITLE);
  });

  it("returns 404 when no override exists", async () => {
    const r = await app.inject({
      method: "DELETE",
      url: `/api/admin/title-overrides/tv/${EXTERNAL_ID}`,
      ...authCookies(session),
    });
    expect(r.statusCode).toBe(404);
  });
});
