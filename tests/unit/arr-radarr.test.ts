import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { RadarrClient } from "@/arr/radarr";
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

describe("RadarrClient.fetchAllItems", () => {
  it("returns an empty array when the upstream returns nothing", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider: makeProvider(),
    });
    expect(await client.fetchAllItems()).toEqual([]);
  });

  it("prefers Radarr's local German alternate title over the provider", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 1,
          tmdbId: 9999,
          title: "The Movie",
          alternateTitles: [{ title: "Der Film", language: { id: 4, name: "German" } }],
        },
      ]),
    );

    const provider = makeProvider(
      new Map([
        [
          "9999",
          makeTitlePayload({
            titlesByLang: { de: "Provider Title (worse)" },
          }),
        ],
      ]),
    );

    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const items = await client.fetchAllItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.germanTitle).toBe("Der Film");
  });

  it("falls back to the provider when no German alternate title is present", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 1,
          tmdbId: 1,
          title: "X",
        },
      ]),
    );

    const provider = makeProvider(
      new Map([["1", makeTitlePayload({ titlesByLang: { de: "iks" } })]]),
    );

    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const items = await client.fetchAllItems();
    expect(items[0]?.germanTitle).toBe("iks");
  });

  it("drops movies without a tmdbId", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, title: "No TMDB" },
        { id: 2, tmdbId: 5, title: "Yes TMDB" },
      ]),
    );

    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider: makeProvider(),
    });

    const items = await client.fetchAllItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.externalId).toBe("5");
  });

  it("recognises German via either the language id (4) or the name", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 1,
          tmdbId: 1,
          title: "X",
          alternateTitles: [{ title: "By id", language: { id: 4 } }],
        },
        {
          id: 2,
          tmdbId: 2,
          title: "Y",
          alternateTitles: [{ title: "By name", language: { name: "German" } }],
        },
      ]),
    );

    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider: makeProvider(),
    });

    const items = await client.fetchAllItems();
    expect(items.find((i) => i.externalId === "1")?.germanTitle).toBe("By id");
    expect(items.find((i) => i.externalId === "2")?.germanTitle).toBe("By name");
  });
});

describe("RadarrClient.fetchRawItems", () => {
  it("picks the German alternate title into germanTitle and keeps the imdbId", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 4,
          tmdbId: 900,
          imdbId: "tt0000900",
          title: "Winter Harbour",
          year: 2021,
          alternateTitles: [
            { title: "Hafen im Winter", language: { id: 4, name: "German" } },
            { title: "Port d'hiver", language: { id: 2, name: "French" } },
          ],
        },
        { id: 5, title: "No TMDB Id Here" },
      ]),
    );
    const provider = makeProvider();
    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const raw = await client.fetchRawItems();

    expect(raw).toEqual([
      {
        arrId: 4,
        externalId: "900",
        imdbId: "tt0000900",
        title: "Winter Harbour",
        year: 2021,
        aliases: ["Hafen im Winter", "Port d'hiver"],
        germanTitle: "Hafen im Winter",
        mediaType: "movie",
        expectedAuthor: null,
      },
    ]);
    expect(provider.fetchBulk).not.toHaveBeenCalled();
  });
});

describe("RadarrClient.deriveItems", () => {
  it("skips the provider for items that already have a German title when only DE is wanted", async () => {
    const provider = makeProvider();
    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    await client.deriveItems([
      {
        arrId: 4,
        externalId: "900",
        imdbId: null,
        title: "Winter Harbour",
        year: 2021,
        aliases: ["Hafen im Winter"],
        germanTitle: "Hafen im Winter",
        mediaType: "movie",
        expectedAuthor: null,
      },
    ]);

    expect(provider.fetchBulk).not.toHaveBeenCalled();
  });

  it("keeps the *Arr's German title and its aliases when the provider is skipped", async () => {
    // germanTitle present + only DE wanted means deriveItems never asks the
    // provider for this item, so nothing of the provider's can leak in.
    const provider = makeProvider(
      new Map([
        [
          "901",
          makeTitlePayload({
            titlesByLang: { de: "Provider Titel" },
            aliasesByLang: { de: ["Provider Alias"] },
          }),
        ],
      ]),
    );
    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const [item] = await client.deriveItems([
      {
        arrId: 5,
        externalId: "901",
        imdbId: "tt0000901",
        title: "Winter Harbour",
        year: 2021,
        aliases: ["Arr Alias"],
        germanTitle: "Hafen im Winter",
        mediaType: "movie",
        expectedAuthor: null,
      },
    ]);

    expect(item?.germanTitle).toBe("Hafen im Winter");
    expect(item?.aliases).toEqual(["Arr Alias"]);
    expect(item?.imdbId).toBe("tt0000901");
  });

  it("merges aliases local-first when the provider is consulted", async () => {
    const provider = makeProvider(
      new Map([
        [
          "902",
          makeTitlePayload({
            titlesByLang: { de: "Provider Titel" },
            aliasesByLang: { de: ["Provider Alias"] },
          }),
        ],
      ]),
    );
    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    const [item] = await client.deriveItems([
      {
        arrId: 6,
        externalId: "902",
        imdbId: null,
        title: "Winter Harbour",
        year: 2021,
        aliases: ["Arr Alias"],
        germanTitle: null,
        mediaType: "movie",
        expectedAuthor: null,
      },
    ]);

    expect(item?.germanTitle).toBe("Provider Titel");
    expect(item?.aliases).toEqual(["Arr Alias", "Provider Alias"]);
  });

  it("skips the provider entirely for an empty input", async () => {
    const provider = makeProvider();
    const client = new RadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://radarr.local",
      apiKey: "k",
      userAgent: "UA",
      provider,
    });

    expect(await client.deriveItems([])).toEqual([]);
    expect(provider.fetchBulk).not.toHaveBeenCalled();
  });
});
