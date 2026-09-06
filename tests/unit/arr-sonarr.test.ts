import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { SonarrClient } from "@/arr/sonarr";
import { makeTitlePayload, type TitleProvider } from "@/providers/types";

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => data,
      text: async () => JSON.stringify(data),
    },
  };
}

function makeProvider(
  bulk: Map<string, ReturnType<typeof makeTitlePayload>> = new Map(),
): TitleProvider {
  return {
    name: "stub",
    supportedLanguages: () => ["de"],
    fetchByExternalId: async () => null,
    fetchByTitle: async () => null,
    fetchBulk: vi.fn().mockResolvedValue(bulk),
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  requestMock.mockReset();
});

describe("SonarrClient.fetchAllItems", () => {
  it("returns an empty array when the upstream returns nothing", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(null, 500));
    const client = new SonarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://sonarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider: makeProvider(),
    });
    expect(await client.fetchAllItems()).toEqual([]);
  });

  it("skips series without a tvdbId and merges provider titles when present", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, tvdbId: 100, title: "Realm of Ravens" },
        { id: 2, title: "No TVDB Id Here" },
        {
          id: 3,
          tvdbId: 200,
          title: "Some Show",
          alternateTitles: [{ title: "Alt 1" }, { title: "Alt 2" }],
        },
      ]),
    );

    const provider = makeProvider(
      new Map([
        [
          "100",
          makeTitlePayload({
            titlesByLang: { de: "Lied der Schwarzen Raben" },
            aliasesByLang: { de: ["LdSR"] },
          }),
        ],
      ]),
    );

    const client = new SonarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://sonarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const items = await client.fetchAllItems();
    expect(items).toHaveLength(2);
    // Series without tvdbId is dropped.
    expect(items.find((i) => i.title === "No TVDB Id Here")).toBeUndefined();
    // Provider data merged for series with a payload.
    const got = items.find((i) => i.externalId === "100");
    expect(got?.germanTitle).toBe("Lied der Schwarzen Raben");
    // Series without provider data falls back to alternateTitles.
    const some = items.find((i) => i.externalId === "200");
    expect(some).toBeDefined();
  });

  it("requests the right path and forwards the api key", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse([]));
    const client = new SonarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://sonarr.local",
      apiKey: "secret-key",
      userAgent: "UA",
      provider: makeProvider(),
    });
    await client.fetchAllItems();
    const url = requestMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/v3/series");
    expect(url).toContain("apikey=secret-key");
    expect(url).toContain("includeSeasonImages=false");
  });
});

describe("SonarrClient.fetchRawItems", () => {
  it("returns the raw *Arr shape without consulting the provider", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 7,
          tvdbId: 300,
          title: "Realm of Ravens",
          year: 2019,
          alternateTitles: [{ title: "Reich der Raben" }],
        },
        { id: 8, title: "No TVDB Id Here" },
      ]),
    );
    const provider = makeProvider();
    const client = new SonarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://sonarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const raw = await client.fetchRawItems();

    expect(raw).toEqual([
      {
        arrId: 7,
        externalId: "300",
        imdbId: null,
        title: "Realm of Ravens",
        year: 2019,
        aliases: ["Reich der Raben"],
        germanTitle: null,
        mediaType: "tv",
        expectedAuthor: null,
      },
    ]);
    expect(provider.fetchBulk).not.toHaveBeenCalled();
  });

  it("normalises a zero or missing year to null", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, tvdbId: 1, title: "A", year: 0 },
        { id: 2, tvdbId: 2, title: "B" },
      ]),
    );
    const client = new SonarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://sonarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider: makeProvider(),
    });

    const raw = await client.fetchRawItems();

    expect(raw.map((r) => r.year)).toEqual([null, null]);
  });
});

describe("SonarrClient.deriveItems", () => {
  it("unions provider aliases ahead of the *Arr's own", async () => {
    const provider = makeProvider(
      new Map([
        [
          "300",
          makeTitlePayload({
            titlesByLang: { de: "Reich der Raben" },
            aliasesByLang: { de: ["Provider Alias"] },
          }),
        ],
      ]),
    );
    const client = new SonarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://sonarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const [item] = await client.deriveItems([
      {
        arrId: 7,
        externalId: "300",
        imdbId: null,
        title: "Realm of Ravens",
        year: 2019,
        aliases: ["Arr Alias"],
        germanTitle: null,
        mediaType: "tv",
        expectedAuthor: null,
      },
    ]);

    expect(item?.germanTitle).toBe("Reich der Raben");
    expect(item?.aliases).toEqual(["Provider Alias", "Arr Alias"]);
    expect(item?.expectedTitle).toBe("Realm of Ravens");
    expect(item?.year).toBe(2019);
  });

  it("skips the provider entirely for an empty input", async () => {
    const provider = makeProvider();
    const client = new SonarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://sonarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    expect(await client.deriveItems([])).toEqual([]);
    expect(provider.fetchBulk).not.toHaveBeenCalled();
  });
});
