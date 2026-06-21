import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

// Bypass the per-host 1s wait so the bulk-chunk test does not block.
vi.mock("@/providers/rate-limit", () => ({
  HostRateLimiter: class {
    async wait(): Promise<void> {
      // no-op for tests
    }
  },
}));

import { PcjonesApiProvider } from "@/providers/pcjones-api";

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      text: async () => JSON.stringify(data),
    },
  };
}

function nonJsonResponse(text: string, statusCode = 200) {
  return {
    statusCode,
    body: {
      text: async () => text,
    },
  };
}

function provider() {
  return new PcjonesApiProvider({
    host: "https://api.example",
    userAgent: "UA-Test",
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  requestMock.mockReset();
});

describe("PcjonesApiProvider.supportedLanguages", () => {
  it("declares German only", () => {
    expect(provider().supportedLanguages()).toEqual(["de"]);
  });
});

describe("PcjonesApiProvider.fetchByExternalId", () => {
  it("returns null for movies without making a request", async () => {
    const out = await provider().fetchByExternalId("movie", "1234");
    expect(out).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("returns a payload for a successful TV lookup with german title and aliases", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        germanTitle: "Realm of Ravens",
        aliases: [{ language: "de", name: "RoR" }, { name: "Rabenkönig" }],
      }),
    );
    const out = await provider().fetchByExternalId("tv", "121361");
    expect(out).not.toBeNull();
    expect(out?.germanTitle).toBe("Realm of Ravens");
    expect(out?.aliases).toEqual(["RoR", "Rabenkönig"]);
    expect(out?.titlesByLang).toEqual({ de: "Realm of Ravens" });
  });

  it("encodes the externalId into the URL", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({ status: "success", germanTitle: "X" }),
    );
    await provider().fetchByExternalId("tv", "id with spaces");
    const url = requestMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/tvshow_german.php?tvdbid=id%20with%20spaces");
  });

  it("returns null on a 4xx response", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({}, 500));
    expect(await provider().fetchByExternalId("tv", "1")).toBeNull();
  });

  it("returns null when the API status is not 'success'", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ status: "no_match" }));
    expect(await provider().fetchByExternalId("tv", "1")).toBeNull();
  });

  it("returns null when neither german title nor aliases are present", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({ status: "success", germanTitle: null, aliases: [] }),
    );
    expect(await provider().fetchByExternalId("tv", "1")).toBeNull();
  });

  it("accepts a plain string[] aliases shape from older backends", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        germanTitle: "Title",
        aliases: ["Alt One", "Alt Two", ""],
      }),
    );
    const out = await provider().fetchByExternalId("tv", "1");
    expect(out?.aliases).toEqual(["Alt One", "Alt Two"]);
  });
});

describe("PcjonesApiProvider.fetchByTitle", () => {
  it("returns null for movies", async () => {
    expect(await provider().fetchByTitle("movie", "X")).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("returns a payload on success with the resolved tvdbId", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        germanTitle: "Match",
        tvdbId: 42,
      }),
    );
    const out = await provider().fetchByTitle("tv", "Match Query");
    expect(out?.germanTitle).toBe("Match");
    expect(out?.externalId).toBe("42");
  });

  it("returns null when the response has no german title", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({ status: "success", germanTitle: null }),
    );
    expect(await provider().fetchByTitle("tv", "X")).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({}, 404));
    expect(await provider().fetchByTitle("tv", "X")).toBeNull();
  });
});

describe("PcjonesApiProvider.fetchBulk", () => {
  it("returns an empty map for movies", async () => {
    const out = await provider().fetchBulk("movie", ["1", "2"]);
    expect(out.size).toBe(0);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("returns an empty map for an empty id list", async () => {
    const out = await provider().fetchBulk("tv", []);
    expect(out.size).toBe(0);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("posts ids in chunks of 50 and merges payloads", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => String(i + 1));
    requestMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: [
            { tvdbId: 1, germanTitle: "Erste" },
            { tvdbId: 2, germanTitle: "Zweite" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: [{ tvdbId: 51, germanTitle: "Letzte" }],
        }),
      );

    const out = await provider().fetchBulk("tv", ids);
    expect(out.size).toBe(3);
    expect(out.get("1")?.germanTitle).toBe("Erste");
    expect(out.get("51")?.germanTitle).toBe("Letzte");
    expect(requestMock).toHaveBeenCalledTimes(2);

    // Inspect the first POST body structure.
    const args = requestMock.mock.calls[0]?.[1] as {
      method: string;
      body: string;
      headers: { "Content-Type": string };
    };
    expect(args.method).toBe("POST");
    expect(args.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(args.body) as { tvdbIds: string[] };
    expect(body.tvdbIds).toHaveLength(50);
  });

  it("skips entries without a tvdbId in the response", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        data: [
          { germanTitle: "Orphan, no id" },
          { tvdbId: 5, germanTitle: "Real" },
        ],
      }),
    );
    const out = await provider().fetchBulk("tv", ["1", "5"]);
    expect(out.size).toBe(1);
    expect(out.get("5")?.germanTitle).toBe("Real");
  });

  it("returns an empty map when the chunk request errors out", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ err: "boom" }, 502));
    const out = await provider().fetchBulk("tv", ["1", "2"]);
    expect(out.size).toBe(0);
  });

  it("returns an empty map when the envelope is malformed", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse({ status: "fail", message: "no" }),
    );
    const out = await provider().fetchBulk("tv", ["1"]);
    expect(out.size).toBe(0);
  });

  it("tolerates a non-JSON body and returns an empty map", async () => {
    requestMock.mockResolvedValueOnce(nonJsonResponse("<html>503</html>", 200));
    const out = await provider().fetchBulk("tv", ["1"]);
    expect(out.size).toBe(0);
  });

  it("returns an empty map on network errors so one failing provider can't abort the composite chain", async () => {
    requestMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const out = await provider().fetchBulk("tv", ["1"]);
    expect(out.size).toBe(0);
  });
});
