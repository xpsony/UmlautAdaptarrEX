import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
  // Agent is constructed by IndexerFetcher to set per-request timeouts; the
  // tests only need a stub whose close() resolves so the dispatcher cache
  // can rebuild without touching real sockets.
  Agent: class {
    async close(): Promise<void> {}
  },
}));

const { mockUrlIsPrivate } = vi.hoisted(() => ({
  mockUrlIsPrivate: vi.fn((_url: string) => false),
}));

vi.mock("@/server/security/ssrf", () => ({
  urlIsPrivate: mockUrlIsPrivate,
}));

vi.mock("@/server/proxy/rate-limiter", async () => {
  const actual = await vi.importActual<typeof import("@/server/proxy/rate-limiter")>(
    "@/server/proxy/rate-limiter",
  );
  return {
    ...actual,
    HostRateLimiter: class {
      async wait(): Promise<void> {
        // bypass per-host pacing in tests
      }
      backoff(): void {
        /* recorded externally if needed */
      }
    },
  };
});

import { IndexerFetcher } from "@/server/proxy/indexer-fetcher";

interface FakeState {
  indexerCache: Map<string, { body: Buffer; contentType: string; status: number }>;
  settings: {
    indexerRateLimitMs: number;
    indexerTimeoutSeconds: number;
    cacheDurationMinutes: number;
    userAgent: string;
    forwardArrUserAgent: boolean;
  };
}

function makeState(): FakeState {
  // The real LRUCache.set takes a third "opts" argument (ttl etc.) that the
  // fetcher passes; back it with a Map and ignore opts so the tests don't
  // need a real LRUCache instance.
  const inner = new Map<string, { body: Buffer; contentType: string; status: number }>();
  const cache = {
    get: (k: string) => inner.get(k),
    set: (k: string, v: { body: Buffer; contentType: string; status: number }, _opts?: unknown) =>
      inner.set(k, v),
    has: (k: string) => inner.has(k),
  };
  return {
    indexerCache: cache as unknown as FakeState["indexerCache"],
    settings: {
      indexerRateLimitMs: 0,
      indexerTimeoutSeconds: 60,
      cacheDurationMinutes: 12,
      userAgent: "UmlautAdaptarrEX/9.9.9",
      forwardArrUserAgent: false,
    },
  };
}

function streamingResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { "content-type": "application/xml", ...headers },
    body: Readable.from([Buffer.from(body)]),
  };
}

beforeEach(() => {
  requestMock.mockReset();
  mockUrlIsPrivate.mockReset();
  mockUrlIsPrivate.mockReturnValue(false);
});

afterEach(() => {
  requestMock.mockReset();
});

describe("IndexerFetcher", () => {
  it("returns a cached response without making a network call", async () => {
    const state = makeState();
    state.indexerCache.set("https://x.example", {
      status: 200,
      contentType: "application/xml",
      body: Buffer.from("cached"),
    });
    const fetcher = new IndexerFetcher(state as never);
    const res = await fetcher.fetch("https://x.example", {});
    expect(res.cacheHit).toBe(true);
    expect(res.body.toString()).toBe("cached");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("caches a successful response keyed by the URL", async () => {
    const state = makeState();
    requestMock.mockResolvedValueOnce(streamingResponse("<rss/>", 200));
    const fetcher = new IndexerFetcher(state as never);

    const res = await fetcher.fetch("https://x.example", {});
    expect(res.cacheHit).toBe(false);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("<rss/>");
    expect(state.indexerCache.has("https://x.example")).toBe(true);
  });

  it("does not cache non-2xx responses", async () => {
    const state = makeState();
    requestMock.mockResolvedValueOnce(streamingResponse("err", 503));
    const fetcher = new IndexerFetcher(state as never);

    const res = await fetcher.fetch("https://x.example", {});
    expect(res.status).toBe(503);
    expect(state.indexerCache.has("https://x.example")).toBe(false);
  });

  function sentHeaders(): Record<string, string> {
    const args = requestMock.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    return args.headers;
  }

  it("strips host/Host/content-length from the forwarded headers", async () => {
    const state = makeState();
    requestMock.mockResolvedValueOnce(streamingResponse("<rss/>", 200));
    const fetcher = new IndexerFetcher(state as never);

    await fetcher.fetch("https://x.example", {
      host: "evil.example",
      Host: "evil.example",
      "content-length": "100",
    });

    expect(sentHeaders().host).toBeUndefined();
    expect(sentHeaders().Host).toBeUndefined();
    expect(sentHeaders()["content-length"]).toBeUndefined();
  });

  it("sends only our own User-Agent by default", async () => {
    const state = makeState();
    requestMock.mockResolvedValueOnce(streamingResponse("<rss/>", 200));
    const fetcher = new IndexerFetcher(state as never);

    await fetcher.fetch("https://x.example", { "user-agent": "Sonarr/4" });

    // Deliberately NOT the old "Sonarr/4 UmlautAdaptarrEX/…" concatenation:
    // that value matched neither client and could defeat the very UA
    // allow-lists that forwarding exists for.
    expect(sentHeaders()["user-agent"]).toBe("UmlautAdaptarrEX/9.9.9");
  });

  it("forwards the *Arr's User-Agent verbatim when the setting is on", async () => {
    const state = makeState();
    state.settings.forwardArrUserAgent = true;
    requestMock.mockResolvedValueOnce(streamingResponse("<rss/>", 200));
    const fetcher = new IndexerFetcher(state as never);

    await fetcher.fetch("https://x.example", {
      "user-agent": "Sonarr/4.0.0.748 (docker)",
    });

    expect(sentHeaders()["user-agent"]).toBe("Sonarr/4.0.0.748 (docker)");
  });

  it("falls back to our own User-Agent when forwarding is on but the *Arr sent none", async () => {
    const state = makeState();
    state.settings.forwardArrUserAgent = true;
    requestMock.mockResolvedValueOnce(streamingResponse("<rss/>", 200));
    const fetcher = new IndexerFetcher(state as never);

    await fetcher.fetch("https://x.example", { "user-agent": "   " });

    expect(sentHeaders()["user-agent"]).toBe("UmlautAdaptarrEX/9.9.9");
  });

  it("follows up to MAX_REDIRECTS but re-checks SSRF on every hop", async () => {
    const state = makeState();
    requestMock
      .mockResolvedValueOnce(streamingResponse("", 301, { location: "https://final.example/" }))
      .mockResolvedValueOnce(streamingResponse("<rss/>", 200));
    const fetcher = new IndexerFetcher(state as never);

    const res = await fetcher.fetch("https://start.example", {});
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("<rss/>");
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("aborts when a redirect target is private", async () => {
    const state = makeState();
    requestMock.mockResolvedValueOnce(
      streamingResponse("", 301, { location: "http://10.0.0.5/admin" }),
    );
    mockUrlIsPrivate.mockImplementation((url: string) => url.startsWith("http://10."));
    const fetcher = new IndexerFetcher(state as never);

    await expect(fetcher.fetch("https://public.example", {})).rejects.toThrow(/private host/);
  });

  it("propagates network errors", async () => {
    const state = makeState();
    requestMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const fetcher = new IndexerFetcher(state as never);

    await expect(fetcher.fetch("https://x.example", {})).rejects.toThrow(/ECONNRESET/);
  });
});
