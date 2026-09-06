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
import { buildTestApp } from "./_setup/app";
import { cleanDb, ensureTestDb } from "./_setup/db";
import { getAppState } from "@/server/state";
import type { IndexerFetcher } from "@/server/proxy/indexer-fetcher";

// End-to-end coverage of the project's reason to exist: legacy /:apiKey/*
// routes the request through the indexer, then rewrites the response XML so
// German release titles become the original (English) title that Sonarr is
// matching against. The chain we exercise:
//
//   handleSearch
//     → assertLegacyContext (auth + SSRF gates)
//     → state.getByExternalId / findByTitle  (cache hit lookup)
//     → fetcher.fetch        (mocked here)
//     → rewriteIndexerXml    (real domain logic)
//     → onRename callback writes prisma.renameHistory
//     → recordRequest        (real)
//
// Reads at the API level catch wiring drift between any pair of these.

let app: FastifyInstance;
const fetchMock = vi.fn();
const fakeFetcher = { fetch: fetchMock } as unknown as IndexerFetcher;

const APP_API_KEY = "search-rewrite-test-key";
const INDEXER = "indexer.example.test";

const GERMAN_RELEASE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TestIndexer</title>
    <item>
      <title>Realm.of.Ravens.Lied.der.Schwarzen.Raben.S01E01.GERMAN</title>
      <category>5000</category>
    </item>
    <item>
      <title>Some.Unrelated.Show.S01E01</title>
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

  const { prisma } = await import("@/lib/db");
  await prisma.setting.create({
    data: {
      id: 1,
      appApiKey: APP_API_KEY,
      operationMode: "legacy",
      setupComplete: true,
    },
  });
  await getAppState().reloadSettings();

  // Drop any cached items left over from previous tests in the file.
  getAppState().removeItemsForInstance("inst-rewrite");
});

function seedShowFixture(): void {
  // Seed a SearchItem so determineSearchItem(spec=tvsearch, params={tvdbid})
  // resolves to it; the rewriter then knows the expectedTitle ("Realm of
  // Ravens") and the German alias to look for ("Lied der Schwarzen Raben").
  getAppState().indexItem({
    id: "show-id",
    arrInstanceId: "inst-rewrite",
    arrId: 1,
    externalId: "121361",
    title: "Realm of Ravens",
    expectedTitle: "Realm of Ravens",
    expectedAuthor: null,
    germanTitle: "Lied der Schwarzen Raben",
    mediaType: "tv",
    year: null,
    titleSearchVariations: ["Lied der Schwarzen Raben"],
    titleMatchVariations: [
      "Realm of Ravens",
      "Realm of Ravens - Lied der Schwarzen Raben",
    ],
    authorMatchVariations: [],
  });
}

describe("legacy /:apiKey/api?t=tvsearch end-to-end rewrite", () => {
  it("rewrites the German alias back to the expected title in the response body", async () => {
    seedShowFixture();
    fetchMock.mockResolvedValue({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from(GERMAN_RELEASE_FIXTURE),
      cacheHit: false,
    });

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=tvsearch&tvdbid=121361&q=Realm+of+Ravens`,
    });
    expect(r.statusCode).toBe(200);

    // Body should contain the canonical "Realm.of.Ravens.S01E01" form (the
    // German alias was scrubbed out by rewriteIndexerXml).
    expect(r.body).toContain("Realm.of.Ravens.S01E01");
    expect(r.body).not.toContain("Lied.der.Schwarzen.Raben");

    // Unrelated items pass through untouched.
    expect(r.body).toContain("Some.Unrelated.Show.S01E01");
  });

  it("writes a RenameHistory row for every rewrite the domain reports", async () => {
    seedShowFixture();
    fetchMock.mockResolvedValue({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from(GERMAN_RELEASE_FIXTURE),
      cacheHit: false,
    });

    await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=tvsearch&tvdbid=121361&q=Realm+of+Ravens`,
    });

    const { prisma } = await import("@/lib/db");
    const renames = await prisma.renameHistory.findMany();
    expect(renames.length).toBeGreaterThanOrEqual(1);
    const entry = renames.find((r) =>
      r.originalTitle.includes("Lied.der.Schwarzen.Raben"),
    );
    expect(entry).toBeDefined();
    expect(entry?.rewrittenTitle).toContain("Realm.of.Ravens");
    expect(entry?.mediaType).toBe("tv");
    expect(entry?.matchedSearchItemId).toBe("show-id");
  });

  it("falls back to title-cache lookup when no externalId is supplied", async () => {
    // No tvdbid query param → determineSearchItem walks state.findByTitle.
    seedShowFixture();
    fetchMock.mockResolvedValue({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from(GERMAN_RELEASE_FIXTURE),
      cacheHit: false,
    });

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=tvsearch&q=Realm+of+Ravens`,
    });
    expect(r.statusCode).toBe(200);
    // Even without an externalId, findByTitle resolves the cached item and
    // the rewrite happens.
    expect(r.body).toContain("Realm.of.Ravens.S01E01");
  });

  it("leaves the body untouched when no SearchItem matches the query", async () => {
    // No seed - determineSearchItem returns null, no rewrites, no rename
    // events. Body comes back exactly as the indexer sent it.
    fetchMock.mockResolvedValue({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from(GERMAN_RELEASE_FIXTURE),
      cacheHit: false,
    });

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=tvsearch&tvdbid=999&q=Realm+of+Ravens`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Lied.der.Schwarzen.Raben");

    const { prisma } = await import("@/lib/db");
    expect(await prisma.renameHistory.count()).toBe(0);
  });

  it("issues a fetch per title-search variation when a SearchItem is present", async () => {
    seedShowFixture();
    fetchMock.mockResolvedValue({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from(GERMAN_RELEASE_FIXTURE),
      cacheHit: false,
    });

    await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=tvsearch&tvdbid=121361&q=Realm+of+Ravens`,
    });

    // 1 main fetch + N variation fetches. The exact count varies with the
    // variation builder, but at minimum the German variation must show up
    // as a separate request without the tvdbid param.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const variation = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("Lied+der+Schwarzen+Raben"),
    );
    expect(variation).toBeDefined();
    expect(String(variation?.[0])).not.toContain("tvdbid=");
  });
});

describe("legacy search records request history regardless of rewrite path", () => {
  it("creates a RequestHistory row even when rewrite is a no-op", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from('<?xml version="1.0"?><rss/>'),
      cacheHit: true,
    });

    await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=movie&imdbid=tt9999999`,
    });

    const { prisma } = await import("@/lib/db");
    const rows = await prisma.requestHistory.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("movie");
    expect(rows[0]?.externalId).toBe("tt9999999");
    expect(rows[0]?.cacheHit).toBe(true);
  });

  it("captures status=502 in RequestHistory when the fetcher fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("upstream timeout"));

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=tvsearch&tvdbid=12&q=Anything`,
    });
    expect(r.statusCode).toBe(502);

    const { prisma } = await import("@/lib/db");
    const rows = await prisma.requestHistory.findMany();
    expect(rows[0]?.status).toBe(502);
  });
});
