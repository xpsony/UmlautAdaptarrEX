import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequest } = vi.hoisted(() => ({
  mockRequest: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: { requestHistory: mockRequest },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    settings: { appApiKey: "" },
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

const { mockIsPrivateHost } = vi.hoisted(() => ({
  mockIsPrivateHost: vi.fn(() => false),
}));

vi.mock("@/server/security/ssrf", () => ({
  isPrivateHost: mockIsPrivateHost,
}));

import {
  assertLegacyContext,
  isApiKeyValid,
  isLegacyContext,
  isLoopbackRequest,
  parseLegacyParams,
  recordRequest,
} from "@/server/routes/legacy/util";

interface FakeRequest {
  ip: string;
  url: string;
  params: { apiKey?: string; "*"?: string };
  headers: Record<string, string | undefined>;
  log: {
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
}

function makeReq(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    ip: "1.2.3.4",
    url: "/key/host/api?t=caps",
    params: { apiKey: "key", "*": "host/api" },
    headers: {},
    log: { warn: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
}

interface FakeReply {
  code: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  _statusCode: number | null;
  _payload: unknown;
}

function makeReply(): FakeReply {
  const reply = {
    _statusCode: null as number | null,
    _payload: null as unknown,
  } as FakeReply;
  reply.code = vi.fn((c: number) => {
    reply._statusCode = c;
    return reply;
  });
  reply.send = vi.fn((p: unknown) => {
    reply._payload = p;
    return reply;
  });
  return reply;
}

beforeEach(() => {
  mockRequest.create.mockReset();
  mockState.settings.appApiKey = "";
  mockIsPrivateHost.mockReset();
  mockIsPrivateHost.mockReturnValue(false);
});

afterEach(() => {
  mockRequest.create.mockReset();
});

describe("isLoopbackRequest", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "returns true for %s",
    (ip) => {
      expect(isLoopbackRequest(makeReq({ ip }) as never)).toBe(true);
    },
  );

  it("returns false for any other IP", () => {
    expect(isLoopbackRequest(makeReq({ ip: "192.168.1.5" }) as never)).toBe(
      false,
    );
  });
});

describe("parseLegacyParams", () => {
  it("returns missing_api_key when apiKey is absent", () => {
    const result = parseLegacyParams(
      makeReq({ params: { "*": "host" } }) as never,
    );
    expect(result).toEqual({ error: "missing_api_key" });
  });

  it("returns missing_target when wildcard is empty", () => {
    const result = parseLegacyParams(
      makeReq({ params: { apiKey: "k", "*": "" } }) as never,
    );
    expect(result).toEqual({ error: "missing_target" });
  });

  it("returns invalid_target for hostnames with disallowed chars", () => {
    const result = parseLegacyParams(
      makeReq({ params: { apiKey: "k", "*": "host name/api" } }) as never,
    );
    expect(result).toEqual({ error: "invalid_target" });
  });

  it("returns private_target when SSRF guard fires for non-loopback callers", () => {
    mockIsPrivateHost.mockReturnValueOnce(true);
    const result = parseLegacyParams(
      makeReq({
        ip: "203.0.113.5",
        params: { apiKey: "k", "*": "10.0.0.1/api" },
      }) as never,
    );
    expect(result).toEqual({ error: "private_target" });
  });

  it("permits private hosts for loopback callers (proxy on :5006 dispatch)", () => {
    mockIsPrivateHost.mockReturnValueOnce(true);
    const result = parseLegacyParams(
      makeReq({
        ip: "127.0.0.1",
        params: { apiKey: "k", "*": "10.0.0.1/api" },
        url: "/k/10.0.0.1/api?t=caps",
      }) as never,
    );
    expect(isLegacyContext(result)).toBe(true);
  });

  it("extracts the search portion from the URL", () => {
    const result = parseLegacyParams(
      makeReq({
        params: { apiKey: "k", "*": "host/api" },
        url: "/k/host/api?t=tvsearch&q=foo",
      }) as never,
    );
    if (isLegacyContext(result)) {
      expect(result.search).toBe("t=tvsearch&q=foo");
    } else {
      throw new Error("expected a legacy context");
    }
  });
});

describe("isApiKeyValid", () => {
  it("treats an empty stored appApiKey as open access (legacy behavior)", () => {
    mockState.settings.appApiKey = "";
    expect(isApiKeyValid("anything")).toBe(true);
  });

  it("rejects mismatched keys with a constant-time comparison", () => {
    mockState.settings.appApiKey = "expected-key-value";
    expect(isApiKeyValid("wrong-key")).toBe(false);
    expect(isApiKeyValid("expected-key-value")).toBe(true);
  });

  it("accepts the underscore sentinel only from loopback", () => {
    mockState.settings.appApiKey = "expected-key";
    expect(isApiKeyValid("_", { fromLoopback: true })).toBe(true);
    expect(isApiKeyValid("_", { fromLoopback: false })).toBe(false);
    expect(isApiKeyValid("_")).toBe(false);
  });

  it("rejects keys whose length differs from the stored one", () => {
    mockState.settings.appApiKey = "abcdefgh";
    expect(isApiKeyValid("abcd")).toBe(false);
  });
});

describe("assertLegacyContext", () => {
  it("returns the context when validation succeeds", () => {
    mockState.settings.appApiKey = "";
    const reply = makeReply();
    const result = assertLegacyContext(
      makeReq() as never,
      reply as never,
      "caps",
    );
    expect(result).not.toBeNull();
  });

  it("sends 400 'Invalid request' when params are bad", () => {
    const reply = makeReply();
    const result = assertLegacyContext(
      makeReq({ params: {} }) as never,
      reply as never,
      "caps",
    );
    expect(result).toBeNull();
    expect(reply._statusCode).toBe(400);
    expect(reply._payload).toBe("Invalid request");
  });

  it("sends 403 Forbidden when the api key does not match", () => {
    mockState.settings.appApiKey = "real-key";
    const reply = makeReply();
    const result = assertLegacyContext(
      makeReq({ params: { apiKey: "wrong", "*": "host/api" } }) as never,
      reply as never,
      "caps",
    );
    expect(result).toBeNull();
    expect(reply._statusCode).toBe(403);
    expect(reply._payload).toBe("Forbidden");
  });

  it("logs no hint for a plain api key mismatch", () => {
    mockState.settings.appApiKey = "real-key";
    const req = makeReq({
      url: "/wrong/host/api?t=caps&apikey=indexer-key",
      params: { apiKey: "wrong", "*": "host/api" },
    });
    assertLegacyContext(req as never, makeReply() as never, "caps");
    expect(req.log.warn.mock.calls[0]![0]).not.toHaveProperty("hint");
  });

  it("hints that the indexer key was put in the path when it equals the apikey query param", () => {
    mockState.settings.appApiKey = "real-key";
    const req = makeReq({
      url: "/indexer-key/host/api?t=caps&apikey=indexer-key",
      params: { apiKey: "indexer-key", "*": "host/api" },
    });
    assertLegacyContext(req as never, makeReply() as never, "caps");
    expect(req.log.warn.mock.calls[0]![0].hint).toMatch(/indexer api key/i);
  });

  it("hints that '_' is not accepted from non-loopback callers", () => {
    mockState.settings.appApiKey = "real-key";
    const req = makeReq({
      url: "/_/host/api?t=caps&apikey=indexer-key",
      params: { apiKey: "_", "*": "host/api" },
    });
    assertLegacyContext(req as never, makeReply() as never, "caps");
    expect(req.log.warn.mock.calls[0]![0].hint).toMatch(/"_"/);
  });
});

describe("recordRequest", () => {
  it("inserts a row with the apikey tail and stripped domain", async () => {
    mockRequest.create.mockResolvedValueOnce({});
    await recordRequest({
      apiKey: "abcdef-very-long-api-key",
      domain: "indexer.example.com/api",
      type: "search",
      query: "foo",
      externalId: null,
      status: 200,
      durationMs: 42,
      cacheHit: false,
    });

    const args = mockRequest.create.mock.calls[0]?.[0] as {
      data: { apiKey: string; domain: string; type: string };
    };
    expect(args.data.apiKey.length).toBe(6);
    expect(args.data.domain).toBe("indexer.example.com");
    expect(args.data.type).toBe("search");
  });

  it("swallows DB failures so the response is not affected", async () => {
    mockRequest.create.mockRejectedValueOnce(new Error("DB locked"));
    const req = makeReq();
    await expect(
      recordRequest(
        {
          apiKey: "k",
          domain: "x",
          type: "caps",
          query: null,
          externalId: null,
          status: 200,
          durationMs: 1,
          cacheHit: false,
        },
        req as never,
      ),
    ).resolves.toBeUndefined();
    expect(req.log.debug).toHaveBeenCalledOnce();
  });
});
