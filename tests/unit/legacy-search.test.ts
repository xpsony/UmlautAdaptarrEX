import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequest, mockRename } = vi.hoisted(() => ({
  mockRequest: { create: vi.fn() },
  mockRename: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: { requestHistory: mockRequest, renameHistory: mockRename },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: { appApiKey: "", indexerTimeoutSeconds: 60 },
    languagePack: {},
    getByExternalId: vi.fn(),
    findByTitle: vi.fn(),
    toRewriteSearchItem: vi.fn(),
    isPausedNow: vi.fn(() => false),
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

vi.mock("@/server/security/ssrf", () => ({
  isPrivateHost: () => false,
}));

const { mockRewrite, mockAggregate } = vi.hoisted(() => ({
  mockRewrite: vi.fn((body: string) => body),
  mockAggregate: vi.fn((bodies: string[]) => bodies.join("|")),
}));

vi.mock("@/domain/xml", () => ({
  rewriteIndexerXml: mockRewrite,
  aggregateIndexerResponses: mockAggregate,
}));

vi.mock("@/domain/normalization/index", () => ({
  getLidarrTitleForExternalId: (s: string) => s,
  getReadarrTitleForExternalId: (s: string) => s,
}));

import { handleSearch } from "@/server/routes/legacy/search";

interface FakeFetcher {
  fetch: ReturnType<typeof vi.fn>;
}

function makeReq(overrides: object = {}) {
  return {
    ip: "127.0.0.1",
    url: "/key/host.example/api?t=tvsearch&q=Realm+of+Ravens",
    params: { apiKey: "key", "*": "host.example/api" },
    headers: { "user-agent": "Sonarr/4" },
    log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
}

interface FakeReply {
  _statusCode: number | null;
  _headers: Record<string, string>;
  _payload: unknown;
  code: ReturnType<typeof vi.fn>;
  header: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeReply(): FakeReply {
  const reply = {
    _statusCode: null,
    _headers: {},
    _payload: null,
  } as FakeReply;
  reply.code = vi.fn((c: number) => {
    reply._statusCode = c;
    return reply;
  });
  reply.header = vi.fn((k: string, v: string) => {
    reply._headers[k] = v;
    return reply;
  });
  reply.send = vi.fn((p: unknown) => {
    reply._payload = p;
    return reply;
  });
  return reply;
}

beforeEach(() => {
  mockRequest.create.mockReset().mockResolvedValue({});
  mockRename.create.mockReset().mockResolvedValue({});
  mockState.settings.appApiKey = "";
  mockState.settings.indexerTimeoutSeconds = 60;
  mockState.getByExternalId.mockReset();
  mockState.findByTitle.mockReset();
  mockState.toRewriteSearchItem.mockReset();
  mockRewrite.mockClear();
  mockAggregate.mockClear();
});

afterEach(() => {
  mockRequest.create.mockReset();
  mockRename.create.mockReset();
});

describe("handleSearch without an upfront searchItem", () => {
  it("forwards a single fetcher response when no item matches the query", async () => {
    mockState.getByExternalId.mockReturnValueOnce(null);
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      }),
    };
    const reply = makeReply();
    await handleSearch(
      makeReq() as never,
      reply as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    expect(fetcher.fetch).toHaveBeenCalledOnce();
    expect(reply._statusCode).toBe(200);
    expect(mockRequest.create).toHaveBeenCalledOnce();
  });

  it("returns 502 when the fetcher throws", async () => {
    mockState.getByExternalId.mockReturnValueOnce(null);
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockRejectedValueOnce(new Error("network")),
    };
    const reply = makeReply();
    await handleSearch(
      makeReq() as never,
      reply as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    expect(reply._statusCode).toBe(502);
  });

  it("never reports cacheHit=true when the response was a failure", async () => {
    // Regression: cacheHit was initialised to true and only AND-narrowed by
    // each successful fetch. A throw on the main (or any variation) fetch
    // ended in the catch block with status=502 but cacheHit still true,
    // so the request-history page showed errors as "cached" hits.
    mockState.getByExternalId.mockReturnValueOnce(null);
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockRejectedValueOnce(new Error("network")),
    };
    await handleSearch(
      makeReq() as never,
      makeReply() as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    expect(mockRequest.create).toHaveBeenCalledOnce();
    const recorded = mockRequest.create.mock.calls[0]![0].data as {
      status: number;
      cacheHit: boolean;
    };
    expect(recorded.status).toBe(502);
    expect(recorded.cacheHit).toBe(false);
  });

  it("masks cacheHit when a variation throw downgrades the status to 502", async () => {
    // Main fetch is a clean cache hit, but a variation fetch throws. Without
    // the fix, cacheHit=true bled through alongside lastStatus=502.
    mockState.getByExternalId.mockReturnValueOnce({
      id: "i1",
      mediaType: "tv",
      expectedTitle: "Realm of Ravens",
      titleSearchVariations: ["Lied der Schwarzen Raben"],
      titleMatchVariations: ["Realm of Ravens", "Lied der Schwarzen Raben"],
      authorMatchVariations: [],
    });
    mockState.toRewriteSearchItem.mockReturnValue({});
    const fetcher: FakeFetcher = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          contentType: "application/xml",
          body: Buffer.from("<rss/>"),
          cacheHit: true,
        })
        .mockRejectedValueOnce(new Error("variation-network")),
    };
    await handleSearch(
      {
        ...makeReq(),
        url: "/key/host.example/api?t=tvsearch&tvdbid=121361&q=Realm+of+Ravens",
      } as never,
      makeReply() as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    expect(mockRequest.create).toHaveBeenCalledOnce();
    const recorded = mockRequest.create.mock.calls[0]![0].data as {
      status: number;
      cacheHit: boolean;
    };
    expect(recorded.status).toBe(502);
    expect(recorded.cacheHit).toBe(false);
  });
});

describe("handleSearch with a searchItem", () => {
  it("issues an extra fetch per title-search variation", async () => {
    mockState.getByExternalId.mockReturnValueOnce({
      id: "i1",
      mediaType: "tv",
      expectedTitle: "Realm of Ravens",
      titleSearchVariations: ["Lied der Schwarzen Raben"],
      titleMatchVariations: ["Realm of Ravens", "Lied der Schwarzen Raben"],
      authorMatchVariations: [],
    });
    mockState.toRewriteSearchItem.mockReturnValue({});
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockResolvedValue({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      }),
    };
    const reply = makeReply();
    await handleSearch(
      {
        ...makeReq(),
        url: "/key/host.example/api?t=tvsearch&tvdbid=121361&q=Realm+of+Ravens",
      } as never,
      reply as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    // 1 main fetch + at least 1 variation fetch.
    expect(fetcher.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(reply._statusCode).toBe(200);
  });

  it("caps the variation fan-out at MAX_VARIATIONS and logs a warning", async () => {
    mockState.getByExternalId.mockReturnValueOnce({
      id: "i1",
      mediaType: "tv",
      expectedTitle: "Var0",
      titleSearchVariations: Array.from({ length: 15 }, (_, i) => `Var${i}`),
      titleMatchVariations: [],
      authorMatchVariations: [],
    });
    mockState.toRewriteSearchItem.mockReturnValue({});
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockResolvedValue({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      }),
    };
    const req = {
      ...makeReq(),
      url: "/key/host.example/api?t=tvsearch&tvdbid=121361",
    };
    const reply = makeReply();
    await handleSearch(
      req as never,
      reply as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    // 1 main fetch + capped at MAX_VARIATIONS (10) variation fetches, not 15.
    expect(fetcher.fetch).toHaveBeenCalledTimes(11);
    expect(reply._statusCode).toBe(200);
    const warnCalls = req.log.warn.mock.calls.filter(
      (call: unknown[]) => call[1] === "legacy search variation fan-out capped or deadline reached",
    );
    expect(warnCalls).toHaveLength(1);
    const [payload] = warnCalls[0]! as [
      {
        requested: number;
        fetched: number;
        capped: boolean;
        deadlineHit: boolean;
        durationMs: number;
      },
    ];
    expect(payload).toMatchObject({
      requested: 15,
      fetched: 10,
      capped: true,
      deadlineHit: false,
    });
    expect(typeof payload.durationMs).toBe("number");
  });

  it("keeps the appended q/expectedTitle tail alive when capping generated variations", async () => {
    // 15 generated variations + a distinct q + a distinct expectedTitle = 17
    // uncapped entries. The cap must trim from the generated head only, never
    // from the appended tail (q, expectedTitle) - those are the highest-value
    // searches and are exactly what an umlaut-heavy title needs most.
    const generated = Array.from({ length: 15 }, (_, i) => `GenVar${i}`);
    mockState.getByExternalId.mockReturnValueOnce({
      id: "i1",
      mediaType: "tv",
      expectedTitle: "ExpectedTitle",
      titleSearchVariations: generated,
      titleMatchVariations: [],
      authorMatchVariations: [],
    });
    mockState.toRewriteSearchItem.mockReturnValue({});
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockResolvedValue({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      }),
    };
    const req = {
      ...makeReq(),
      url: "/key/host.example/api?t=tvsearch&tvdbid=121361&q=UserQuery",
    };
    const reply = makeReply();
    await handleSearch(
      req as never,
      reply as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    // main fetch + capped-at-10 variation fetches (8 generated + q + expectedTitle).
    expect(fetcher.fetch).toHaveBeenCalledTimes(11);
    expect(reply._statusCode).toBe(200);
    const variationQueries = fetcher.fetch.mock.calls
      .slice(1) // drop the main (non-variation) fetch
      .map((call: unknown[]) => new URLSearchParams(new URL(call[0] as string).search).get("q"));
    expect(variationQueries).toHaveLength(10);
    // Both tail entries survived the cap.
    expect(variationQueries).toContain("UserQuery");
    expect(variationQueries).toContain("ExpectedTitle");
    // Only the LAST generated entries were dropped (8 kept, 7 dropped).
    const keptGenerated = variationQueries.filter((v) => v?.startsWith("GenVar"));
    expect(keptGenerated).toHaveLength(8);
    expect(keptGenerated).toEqual(generated.slice(0, 8));
    expect(variationQueries).not.toContain("GenVar8");
    expect(variationQueries).not.toContain("GenVar14");
  });

  it("stops issuing variation fetches once the search deadline is exceeded", async () => {
    mockState.settings.indexerTimeoutSeconds = 10; // budget = 7_500ms
    mockState.getByExternalId.mockReturnValueOnce({
      id: "i1",
      mediaType: "tv",
      expectedTitle: "Var0",
      titleSearchVariations: ["Var0", "Var1", "Var2"],
      titleMatchVariations: [],
      authorMatchVariations: [],
    });
    mockState.toRewriteSearchItem.mockReturnValue({});

    // Drive Date.now() from the fetcher itself: the main fetch is "fast", and
    // each variation fetch simulates burning a chunk of the search budget so
    // the 3rd variation's pre-fetch deadline check trips before it is issued.
    let now = 0;
    let calls = 0;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockImplementation(async () => {
        calls++;
        now = calls === 1 ? 100 : now + 3_750;
        return {
          status: 200,
          contentType: "application/xml",
          body: Buffer.from("<rss/>"),
          cacheHit: false,
        };
      }),
    };
    const req = {
      ...makeReq(),
      url: "/key/host.example/api?t=tvsearch&tvdbid=121361",
    };
    const reply = makeReply();
    try {
      await handleSearch(
        req as never,
        reply as never,
        { type: "tvsearch" },
        { fetcher: fetcher as never },
      );
      // main + 2 variation fetches; the 3rd is skipped by the deadline check,
      // but the 2 collected variation bodies + the initial body still
      // aggregate and return normally.
      expect(fetcher.fetch).toHaveBeenCalledTimes(3);
      expect(reply._statusCode).toBe(200);
      expect(mockAggregate).toHaveBeenCalledWith(["<rss/>", "<rss/>", "<rss/>"]);
      const warnCalls = req.log.warn.mock.calls.filter(
        (call: unknown[]) =>
          call[1] === "legacy search variation fan-out capped or deadline reached",
      );
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]![0]).toMatchObject({
        requested: 3,
        fetched: 2,
        capped: false,
        deadlineHit: true,
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});

describe("handleSearch routing variants", () => {
  it("falls through to title-based lookup for tvsearch with a 'q' param only", async () => {
    mockState.findByTitle.mockReturnValueOnce(null);
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      }),
    };
    await handleSearch(
      {
        ...makeReq(),
        url: "/key/host.example/api?t=tvsearch&q=Some+Show",
      } as never,
      makeReply() as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    expect(mockState.findByTitle).toHaveBeenCalledWith("tv", "Some Show");
  });

  it("uses the readarr category map for ?t=search with a book category", async () => {
    mockState.getByExternalId.mockReturnValueOnce(null);
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      }),
    };
    await handleSearch(
      {
        ...makeReq(),
        url: "/key/host.example/api?t=search&q=Some+Book&cat=7000",
      } as never,
      makeReply() as never,
      { type: "search" },
      { fetcher: fetcher as never },
    );
    expect(mockState.getByExternalId).toHaveBeenCalledWith("book", "Some Book");
  });

  it("uses the lidarr category map for ?t=search with an audio category", async () => {
    mockState.getByExternalId.mockReturnValueOnce(null);
    const fetcher: FakeFetcher = {
      fetch: vi.fn().mockResolvedValueOnce({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      }),
    };
    await handleSearch(
      {
        ...makeReq(),
        url: "/key/host.example/api?t=search&q=Some+Album&cat=3000",
      } as never,
      makeReply() as never,
      { type: "search" },
      { fetcher: fetcher as never },
    );
    expect(mockState.getByExternalId).toHaveBeenCalledWith("audio", "Some Album");
  });
});

describe("handleSearch validation", () => {
  it("rejects when assertLegacyContext fails (missing target)", async () => {
    const fetcher: FakeFetcher = { fetch: vi.fn() };
    const reply = makeReply();
    await handleSearch(
      makeReq({ params: {} }) as never,
      reply as never,
      { type: "tvsearch" },
      { fetcher: fetcher as never },
    );
    expect(reply._statusCode).toBe(400);
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });
});
