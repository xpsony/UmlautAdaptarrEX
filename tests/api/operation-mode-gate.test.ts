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

// The operationMode gate lives in src/server/index.ts (and is mirrored in
// buildTestApp): in "proxy" mode the legacy /:apiKey/* dispatcher must reply
// 503 + a German hint to non-loopback callers, but stay open to loopback so
// the co-hosted HTTP-proxy on :5006 can reuse the shared handlers.

let app: FastifyInstance;
const fetchMock = vi.fn();
const fakeFetcher = { fetch: fetchMock } as unknown as IndexerFetcher;

const APP_API_KEY = "op-mode-test-key";
const INDEXER = "indexer.example.test";

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
});

async function setOperationMode(
  mode: "proxy" | "legacy" | "both",
): Promise<void> {
  const { prisma } = await import("@/lib/db");
  await prisma.setting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      appApiKey: APP_API_KEY,
      operationMode: mode,
      setupComplete: true,
    },
    update: { operationMode: mode },
  });
  await getAppState().reloadSettings();
}

function publicCaller(): { remoteAddress: string } {
  // light-my-request defaults remoteAddress to 127.0.0.1, which the legacy
  // gate treats as loopback. Set a routable IP to simulate a real
  // Sonarr/Radarr instance reaching out from the LAN.
  return { remoteAddress: "192.168.1.42" };
}

describe("operationMode = 'proxy'", () => {
  it("rejects non-loopback legacy requests with a 503 plain-text hint", async () => {
    await setOperationMode("proxy");

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=caps`,
      ...publicCaller(),
    });
    expect(r.statusCode).toBe(503);
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
    expect(r.body).toContain("Index Legacy Api");
    // The fetcher must NOT be called when the gate triggers - otherwise the
    // proxy mode would still hit the indexer.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permits loopback callers so the co-hosted HTTP-proxy keeps working", async () => {
    await setOperationMode("proxy");
    fetchMock.mockResolvedValueOnce({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from("<caps/>"),
      cacheHit: false,
    });

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=caps`,
      remoteAddress: "127.0.0.1",
    });
    expect(r.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("operationMode = 'legacy'", () => {
  it("permits non-loopback legacy requests", async () => {
    await setOperationMode("legacy");
    fetchMock.mockResolvedValueOnce({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from("<caps/>"),
      cacheHit: false,
    });

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=caps`,
      ...publicCaller(),
    });
    expect(r.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("operationMode = 'both'", () => {
  it("permits non-loopback legacy requests (same as legacy mode)", async () => {
    await setOperationMode("both");
    fetchMock.mockResolvedValueOnce({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from("<caps/>"),
      cacheHit: false,
    });

    const r = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=caps`,
      ...publicCaller(),
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("operationMode flips live without a restart for the 5005 gate", () => {
  it("toggling proxy → legacy at runtime opens the route for non-loopback", async () => {
    await setOperationMode("proxy");
    const closed = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=caps`,
      ...publicCaller(),
    });
    expect(closed.statusCode).toBe(503);

    await setOperationMode("legacy");
    fetchMock.mockResolvedValueOnce({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from("<caps/>"),
      cacheHit: false,
    });
    const open = await app.inject({
      method: "GET",
      url: `/${APP_API_KEY}/${INDEXER}/api?t=caps`,
      ...publicCaller(),
    });
    expect(open.statusCode).toBe(200);
  });
});
