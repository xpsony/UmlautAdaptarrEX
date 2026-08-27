import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RewriteOptionsLike {
  onRename?: ((event: object) => void) | undefined;
  onSkip?: ((event: object) => void) | undefined;
  lookup?: ((mediaType: string, cleanTitle: string) => unknown) | undefined;
  [key: string]: unknown;
}

const { mockRequest, mockRename } = vi.hoisted(() => ({
  mockRequest: { create: vi.fn() },
  mockRename: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: { requestHistory: mockRequest, renameHistory: mockRename },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: {
      appApiKey: "",
      indexerTimeoutSeconds: 60,
      onDemandLookup: true,
      tvVariationSearch: true,
      movieVariationSearch: true,
      maxTitleVariations: 10,
    },
    languagePack: {},
    getByExternalId: vi.fn(),
    getByImdbId: vi.fn(),
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

const { mockResolveOnDemand } = vi.hoisted(() => ({ mockResolveOnDemand: vi.fn() }));

vi.mock("@/server/on-demand/resolve", () => ({
  resolveOnDemand: mockResolveOnDemand,
}));

const { mockRewrite, mockAggregate } = vi.hoisted(() => ({
  mockRewrite: vi.fn(
    // The second parameter is typed loosely on purpose: tests reach into the
    // callbacks the route passes (onRename/onSkip/lookup) without restating
    // the full RewriteOptions shape.
    (body: string, _opts?: RewriteOptionsLike) => body,
  ),
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
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
  mockState.settings.onDemandLookup = true;
  mockState.settings.tvVariationSearch = true;
  mockState.settings.movieVariationSearch = true;
  // 10 keeps the pre-existing fan-out tests asserting the old hard-coded cap.
  mockState.settings.maxTitleVariations = 10;
  mockState.getByExternalId.mockReset();
  mockState.getByImdbId.mockReset();
  mockState.findByTitle.mockReset();
  mockState.isPausedNow.mockReset().mockReturnValue(false);
  mockResolveOnDemand.mockReset().mockResolvedValue(null);
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
    // maxTitleVariations counts the GENERATED German variations only; the
    // tail (q + expectedTitle) is appended on top and never capped. So with
    // a cap of 10: 1 main + 10 generated + 2 tail = 13.
    expect(fetcher.fetch).toHaveBeenCalledTimes(13);
    expect(reply._statusCode).toBe(200);
    const variationQueries = fetcher.fetch.mock.calls
      .slice(1) // drop the main (non-variation) fetch
      .map((call: unknown[]) => new URLSearchParams(new URL(call[0] as string).search).get("q"));
    expect(variationQueries).toHaveLength(12);
    // Both tail entries survived the cap.
    expect(variationQueries).toContain("UserQuery");
    expect(variationQueries).toContain("ExpectedTitle");
    // Only the LAST generated entries were dropped (10 kept, 5 dropped).
    const keptGenerated = variationQueries.filter((v) => v?.startsWith("GenVar"));
    expect(keptGenerated).toHaveLength(10);
    expect(keptGenerated).toEqual(generated.slice(0, 10));
    expect(variationQueries).not.toContain("GenVar10");
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

describe("on-demand lookup wiring", () => {
  function okFetcher(times = 8): FakeFetcher {
    const fetcher: FakeFetcher = { fetch: vi.fn() };
    for (let i = 0; i < times; i++) {
      fetcher.fetch.mockResolvedValueOnce({
        status: 200,
        contentType: "application/xml",
        body: Buffer.from("<rss/>"),
        cacheHit: false,
      });
    }
    return fetcher;
  }

  async function run(search: string, type: "tvsearch" | "movie", fetcher = okFetcher()) {
    const reply = makeReply();
    await handleSearch(
      { ...makeReq(), url: `/key/host.example/api${search}` } as never,
      reply as never,
      { type },
      { fetcher: fetcher as never },
    );
    return { reply, fetcher };
  }

  const RESOLVED = {
    id: "on-demand:tv:999",
    ephemeral: true,
    mediaType: "tv",
    expectedTitle: "Realm of Ravens",
    titleSearchVariations: ["Lied der Schwarzen Raben"],
    titleMatchVariations: ["Realm of Ravens", "Lied der Schwarzen Raben"],
    authorMatchVariations: [],
  };

  it("fires for a tvsearch whose tvdbid is unknown", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    await run("?t=tvsearch&tvdbid=999&q=Some+Show", "tvsearch");

    expect(mockResolveOnDemand).toHaveBeenCalledWith(
      { mediaType: "tv", externalId: "999", imdbId: null },
      expect.anything(),
    );
  });

  it("does not fire when the tvdbid is already indexed", async () => {
    mockState.getByExternalId.mockReturnValue({
      id: "i1",
      mediaType: "tv",
      expectedTitle: "Known",
      titleSearchVariations: [],
      titleMatchVariations: ["Known"],
      authorMatchVariations: [],
    });
    mockState.toRewriteSearchItem.mockReturnValue({});
    await run("?t=tvsearch&tvdbid=100&q=Known", "tvsearch");

    expect(mockResolveOnDemand).not.toHaveBeenCalled();
  });

  it("uses the resolved item as the upfront search item for a tvsearch", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    mockState.toRewriteSearchItem.mockReturnValue({});
    mockResolveOnDemand.mockResolvedValue(RESOLVED);
    const { fetcher } = await run("?t=tvsearch&tvdbid=999&q=Realm+of+Ravens", "tvsearch");

    // A resolved item means the variation fan-out runs, so more than the one
    // main fetch went out.
    expect(fetcher.fetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("fires for a movie search by tmdbid", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    await run("?t=movie&tmdbid=900", "movie");

    expect(mockResolveOnDemand).toHaveBeenCalledWith(
      { mediaType: "movie", externalId: "900", imdbId: null },
      expect.anything(),
    );
  });

  it("does not use a resolved movie as the upfront rewrite item", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    mockResolveOnDemand.mockResolvedValue({ ...RESOLVED, mediaType: "movie" });
    await run("?t=movie&tmdbid=900", "movie");

    // The movie route keeps the per-item lookup path for the rewrite even
    // when the on-demand lookup resolved something; only the fan-out uses
    // the resolved item.
    const opts = mockRewrite.mock.calls[0]![1] as RewriteOptionsLike;
    expect(opts.searchItem).toBeNull();
    expect(typeof opts.lookup).toBe("function");
  });

  it("fires for a movie search by imdbid only, in canonical form", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    mockState.getByImdbId.mockReturnValue(null);
    await run("?t=movie&imdbid=1234567", "movie");

    expect(mockResolveOnDemand).toHaveBeenCalledWith(
      { mediaType: "movie", externalId: null, imdbId: "tt1234567" },
      expect.anything(),
    );
  });

  it("does not fire for a movie whose imdbid is already indexed", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    mockState.getByImdbId.mockReturnValue({ id: "i1", mediaType: "movie" });
    await run("?t=movie&imdbid=1234567", "movie");

    expect(mockResolveOnDemand).not.toHaveBeenCalled();
  });

  it("does not fire while paused", async () => {
    mockState.isPausedNow.mockReturnValue(true);
    mockState.getByExternalId.mockReturnValue(null);
    await run("?t=tvsearch&tvdbid=999&q=Some+Show", "tvsearch");

    expect(mockResolveOnDemand).not.toHaveBeenCalled();
  });

  it("does not fire for a music or book search", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    await run("?t=movie", "movie");

    expect(mockResolveOnDemand).not.toHaveBeenCalled();
  });

  it("leaves the response untouched when the lookup misses", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    mockResolveOnDemand.mockResolvedValue(null);
    const { reply, fetcher } = await run("?t=tvsearch&tvdbid=999&q=Some+Show", "tvsearch");

    expect(reply._statusCode).toBe(200);
    expect(fetcher.fetch).toHaveBeenCalledOnce();
  });

  it("keeps an ephemeral item out of the rename history", async () => {
    mockState.getByExternalId.mockReturnValue(null);
    mockState.toRewriteSearchItem.mockReturnValue({});
    mockResolveOnDemand.mockResolvedValue(RESOLVED);
    mockRewrite.mockImplementationOnce((body: string, opts?: RewriteOptionsLike) => {
      opts?.onRename?.({
        originalTitle: "Lied der Schwarzen Raben S01E01",
        rewrittenTitle: "Realm of Ravens S01E01",
        mediaType: "tv",
      });
      return body;
    });

    await run("?t=tvsearch&tvdbid=999&q=Realm+of+Ravens", "tvsearch");

    expect(mockRename.create).toHaveBeenCalled();
    const data = mockRename.create.mock.calls[0]![0].data as { matchedSearchItemId: string | null };
    expect(data.matchedSearchItemId).toBeNull();
  });
});

// Shared helpers for the cap and fan-out suites below.
function okFetcher(times = 10): FakeFetcher {
  const fetcher: FakeFetcher = { fetch: vi.fn() };
  for (let i = 0; i < times; i++) {
    fetcher.fetch.mockResolvedValueOnce({
      status: 200,
      contentType: "application/xml",
      body: Buffer.from("<rss/>"),
      cacheHit: false,
    });
  }
  return fetcher;
}

async function runSearch(
  search: string,
  type: "tvsearch" | "movie",
  fetcher: FakeFetcher = okFetcher(),
) {
  const reply = makeReply();
  await handleSearch(
    { ...makeReq(), url: `/key/host.example/api${search}` } as never,
    reply as never,
    { type },
    { fetcher: fetcher as never },
  );
  return { reply, fetcher };
}

describe("variation cap", () => {
  const MANY = Array.from({ length: 12 }, (_, i) => `Variante ${i}`);

  function itemWithVariations() {
    return {
      id: "i1",
      mediaType: "tv",
      expectedTitle: "Realm of Ravens",
      titleSearchVariations: MANY,
      titleMatchVariations: ["Realm of Ravens"],
      authorMatchVariations: [],
    };
  }

  it("caps the German variations and still appends q and expectedTitle", async () => {
    mockState.settings.maxTitleVariations = 3;
    mockState.getByExternalId.mockReturnValue(itemWithVariations());
    mockState.toRewriteSearchItem.mockReturnValue({});

    const { fetcher } = await runSearch(
      "?t=tvsearch&tvdbid=100&q=Some+Other+Query",
      "tvsearch",
      okFetcher(20),
    );

    // 1 main + 3 German variations + q + expectedTitle = 6
    expect(fetcher.fetch).toHaveBeenCalledTimes(6);
  });

  it("honours a cap of one", async () => {
    mockState.settings.maxTitleVariations = 1;
    mockState.getByExternalId.mockReturnValue(itemWithVariations());
    mockState.toRewriteSearchItem.mockReturnValue({});

    const { fetcher } = await runSearch(
      "?t=tvsearch&tvdbid=100&q=Some+Other+Query",
      "tvsearch",
      okFetcher(20),
    );

    expect(fetcher.fetch).toHaveBeenCalledTimes(4);
  });

  it("never trims q or expectedTitle away", async () => {
    mockState.settings.maxTitleVariations = 1;
    mockState.getByExternalId.mockReturnValue(itemWithVariations());
    mockState.toRewriteSearchItem.mockReturnValue({});

    const { fetcher } = await runSearch(
      "?t=tvsearch&tvdbid=100&q=Some+Other+Query",
      "tvsearch",
      okFetcher(20),
    );

    const queries = fetcher.fetch.mock.calls
      .slice(1)
      .map((c) => new URLSearchParams(new URL(String(c[0])).search).get("q"));
    expect(queries).toContain("Some Other Query");
    expect(queries).toContain("Realm of Ravens");
  });
});

describe("movie variation fan-out", () => {
  const MOVIE = {
    id: "m1",
    mediaType: "movie",
    expectedTitle: "Winter Harbour",
    titleSearchVariations: ["Hafen im Winter"],
    titleMatchVariations: ["Winter Harbour", "Hafen im Winter"],
    authorMatchVariations: [],
  };

  it("fans out for a movie resolved by tmdbid", async () => {
    mockState.settings.movieVariationSearch = true;
    mockState.getByExternalId.mockReturnValue(MOVIE);

    const { fetcher } = await runSearch("?t=movie&tmdbid=900", "movie");

    expect(fetcher.fetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not fan out when the movie toggle is off", async () => {
    mockState.settings.movieVariationSearch = false;
    mockState.getByExternalId.mockReturnValue(MOVIE);

    const { fetcher } = await runSearch("?t=movie&tmdbid=900", "movie");

    expect(fetcher.fetch).toHaveBeenCalledOnce();
  });

  it("does not fan out for tv when the tv toggle is off", async () => {
    mockState.settings.tvVariationSearch = false;
    mockState.getByExternalId.mockReturnValue({
      id: "i1",
      mediaType: "tv",
      expectedTitle: "Realm of Ravens",
      titleSearchVariations: ["Lied der Schwarzen Raben"],
      titleMatchVariations: ["Realm of Ravens"],
      authorMatchVariations: [],
    });
    mockState.toRewriteSearchItem.mockReturnValue({});

    const { fetcher } = await runSearch("?t=tvsearch&tvdbid=100&q=Realm+of+Ravens", "tvsearch");

    expect(fetcher.fetch).toHaveBeenCalledOnce();
  });

  it("keeps the per-item lookup path for movies, so other titles still rewrite", async () => {
    mockState.settings.movieVariationSearch = true;
    mockState.getByExternalId.mockReturnValue(MOVIE);

    await runSearch("?t=movie&tmdbid=900", "movie");

    // searchItem stays null for movies, so rewriteIndexerXml must receive a
    // `lookup` callback rather than a concrete item.
    const opts = mockRewrite.mock.calls[0]![1] as RewriteOptionsLike;
    expect(opts.searchItem).toBeNull();
    expect(typeof opts.lookup).toBe("function");
  });

  it("resolves a movie fan-out item by imdbid as well", async () => {
    mockState.settings.movieVariationSearch = true;
    mockState.getByExternalId.mockReturnValue(null);
    mockState.getByImdbId.mockReturnValue(MOVIE);

    const { fetcher } = await runSearch("?t=movie&imdbid=1234567", "movie");

    expect(mockState.getByImdbId).toHaveBeenCalledWith("tt1234567");
    expect(fetcher.fetch.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("onDemandLookup toggle", () => {
  it("does not fire the lookup when the setting is off", async () => {
    mockState.settings.onDemandLookup = false;
    mockState.getByExternalId.mockReturnValue(null);

    await runSearch("?t=tvsearch&tvdbid=999&q=Some+Show", "tvsearch");

    expect(mockResolveOnDemand).not.toHaveBeenCalled();
  });
});
