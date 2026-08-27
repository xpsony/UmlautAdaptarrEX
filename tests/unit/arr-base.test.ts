import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { ArrClient, type ArrClientOptions } from "@/arr/base";

// Minimal concrete subclass that exposes the protected helpers so we can test
// the shared HTTP/JSON-decoding logic without spinning up Sonarr or Radarr.
class TestClient extends ArrClient {
  constructor(opts: ArrClientOptions) {
    super(opts);
  }

  async fetchAllItems() {
    return [];
  }

  async json<T>(path: string, params: Record<string, string> = {}) {
    return this.getJson<T>(path, params);
  }

  async nested<P, C>(args: {
    parentPath: string;
    childPath: string;
    childParams: (parent: P) => Record<string, string>;
    map: (parent: P, child: C) => unknown;
  }) {
    return this.fetchNested<P, C, unknown>(args as Parameters<TestClient["fetchNested"]>[0]);
  }
}

const baseOpts: ArrClientOptions = {
  instanceId: "i-1",
  instanceName: "Test",
  host: "http://arr.local/",
  apiKey: "the-api-key",
  userAgent: "UmlautAdaptarr/2.0",
};

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => data,
      text: async () => JSON.stringify(data),
    },
  };
}

function textResponse(text: string, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => {
        throw new Error("not json");
      },
      text: async () => text,
    },
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  requestMock.mockReset();
});

describe("ArrClient host normalization", () => {
  it("strips a single trailing slash so URL building stays predictable", async () => {
    const client = new TestClient({ ...baseOpts, host: "http://arr.local/" });
    requestMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client.json("/api/v3/system");
    expect(requestMock).toHaveBeenCalledOnce();
    const url = requestMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith("http://arr.local/api/v3/system?")).toBe(true);
  });
});

describe("ArrClient.getJson", () => {
  it("appends the api key as the last query param", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client.json("/api/v3/series", { includeImages: "false" });
    const url = requestMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("includeImages=false");
    expect(url).toContain("apikey=the-api-key");
  });

  it("returns parsed JSON on a 2xx response", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockResolvedValueOnce(jsonResponse({ a: 1 }));
    const result = await client.json<{ a: number }>("/p");
    expect(result).toEqual({ a: 1 });
  });

  it("returns null on a 4xx response", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockResolvedValueOnce(jsonResponse({ message: "nope" }, 401));
    expect(await client.json("/p")).toBeNull();
  });

  it("returns null on a 5xx response", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockResolvedValueOnce(jsonResponse({ err: "boom" }, 500));
    expect(await client.json("/p")).toBeNull();
  });

  it("returns null when the body is not valid JSON", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockResolvedValueOnce(textResponse("<html>", 200));
    expect(await client.json("/p")).toBeNull();
  });

  it("returns null on a network error", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await client.json("/p")).toBeNull();
  });

  it("uses a custom timeout when one is provided", async () => {
    const client = new TestClient({ ...baseOpts, timeoutMs: 1000 });
    requestMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client.json("/p");
    const args = requestMock.mock.calls[0]?.[1] as {
      bodyTimeout: number;
      headersTimeout: number;
    };
    expect(args.bodyTimeout).toBe(1000);
    expect(args.headersTimeout).toBe(1000);
  });

  it("falls back to a 30s timeout when none is provided", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockResolvedValueOnce(jsonResponse({}));
    await client.json("/p");
    const args = requestMock.mock.calls[0]?.[1] as { bodyTimeout: number };
    expect(args.bodyTimeout).toBe(30_000);
  });
});

describe("ArrClient.fetchNested", () => {
  it("returns an empty array when the parent fetch fails", async () => {
    const client = new TestClient(baseOpts);
    requestMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const out = await client.nested({
      parentPath: "/parents",
      childPath: "/children",
      childParams: () => ({}),
      map: () => ({}) as never,
    });
    expect(out).toEqual([]);
  });

  it("loops through every parent and concatenates child results", async () => {
    const client = new TestClient(baseOpts);
    requestMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }, { id: 2 }]))
      .mockResolvedValueOnce(jsonResponse([{ name: "a" }, { name: "b" }]))
      .mockResolvedValueOnce(jsonResponse([{ name: "c" }]));

    const out = await client.nested<{ id: number }, { name: string }>({
      parentPath: "/parents",
      childPath: "/children",
      childParams: (p) => ({ pid: String(p.id) }),
      map: (parent, child) => ({ pid: parent.id, n: child.name }) as never,
    });

    expect(out).toEqual([
      { pid: 1, n: "a" },
      { pid: 1, n: "b" },
      { pid: 2, n: "c" },
    ]);
  });

  it("skips parents whose child fetch fails without aborting the loop", async () => {
    const client = new TestClient(baseOpts);
    requestMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }, { id: 2 }]))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse([{ name: "ok" }]));

    const out = await client.nested<{ id: number }, { name: string }>({
      parentPath: "/parents",
      childPath: "/children",
      childParams: (p) => ({ pid: String(p.id) }),
      map: (parent, child) => ({ pid: parent.id, n: child.name }) as never,
    });

    expect(out).toEqual([{ pid: 2, n: "ok" }]);
  });
});

it("fetchNested maps to whatever type the caller asks for", async () => {
  requestMock.mockResolvedValueOnce(jsonResponse([{ id: 1, name: "P" }]));
  requestMock.mockResolvedValueOnce(jsonResponse([{ id: 10, label: "C" }]));

  class ShapeClient extends ArrClient {
    // Task 6 turns fetchRawItems/deriveItems into the abstract pair; at this
    // point the base still declares `abstract fetchAllItems`.
    async fetchAllItems() {
      return [];
    }

    async run(): Promise<{ pair: string }[]> {
      return this.fetchNested<
        { id: number; name: string },
        { id: number; label: string },
        { pair: string }
      >({
        parentPath: "/p",
        childPath: "/c",
        childParams: (parent) => ({ parentId: String(parent.id) }),
        map: (parent, child) => ({ pair: `${parent.name}:${child.label}` }),
      });
    }
  }

  const client = new ShapeClient({
    instanceId: "i",
    instanceName: "n",
    host: "http://arr.local",
    apiKey: "k",
    userAgent: "UA",
  });

  expect(await client.run()).toEqual([{ pair: "P:C" }]);
});
