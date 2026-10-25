import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { LidarrClient } from "@/arr/lidarr";

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => data,
      text: async () => JSON.stringify(data),
    },
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  requestMock.mockReset();
});

describe("LidarrClient.fetchAllItems", () => {
  it("returns an empty array when the artist fetch fails", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const client = new LidarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://lidarr.local",
      apiKey: "k",
      userAgent: "UA",
    });
    expect(await client.fetchAllItems()).toEqual([]);
  });

  it("flattens artist+album into one item per album", async () => {
    requestMock
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 1, artistName: "Artist A" },
          { id: 2, artistName: "Artist B" },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 10, artistId: 1, title: "Album One" },
          { id: 11, artistId: 1, title: "Album Two" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 20, artistId: 2, title: "Solo" }]));

    const client = new LidarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://lidarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const items = await client.fetchAllItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.title).sort()).toEqual(["Album One", "Album Two", "Solo"]);
    expect(items.every((i) => i.mediaType === "audio")).toBe(true);
  });

  it("derives externalId from '{artist} {album}' so same-titled albums across artists do not collide", async () => {
    requestMock
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 1, artistName: "Nordlicht" },
          { id: 2, artistName: "Kranichflug" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 10, artistId: 1, title: "Best Of" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 20, artistId: 2, title: "Best Of" }]));

    const client = new LidarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://lidarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const items = await client.fetchAllItems();
    expect(items).toHaveLength(2);
    const externalIds = items.map((i) => i.externalId);
    expect(new Set(externalIds).size).toBe(2);
    expect(externalIds).toContain("nordlicht best of");
    expect(externalIds).toContain("kranichflug best of");
  });

  it("keys an album by the search Lidarr sends, umlauts stripped, so t=search finds it", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, artistName: "The Bären" }]))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 10,
            artistId: 1,
            title: "Mondfähre",
            disambiguation: "Deluxe",
            releaseDate: "2004-01-01T00:00:00Z",
          },
          { id: 11, artistId: 1, title: "The Bären", releaseDate: "2009-01-01T00:00:00Z" },
        ]),
      );
    const client = new LidarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://lidarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const [deluxe, selfTitled] = await client.fetchRawItems();
    // Lidarr's default query: "Baren Mondfahre Deluxe"; raw: "The Bären Mondfähre Deluxe".
    expect(deluxe?.externalId).toBe("baren mondfahre deluxe");
    expect(deluxe?.externalIdAliases).toEqual(["the baren mondfahre deluxe"]);
    // Self-titled: Lidarr appends the release year.
    expect(selfTitled?.externalId).toBe("baren baren 2009");
    expect(deluxe?.title).toBe("Mondfähre");
  });
});

describe("LidarrClient raw/derive split", () => {
  it("fetchRawItems returns audio raw items and deriveItems maps them 1:1", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse([{ id: 3, artistName: "Nordlicht" }]));
    requestMock.mockResolvedValueOnce(jsonResponse([{ id: 30, artistId: 3, title: "Polarnacht" }]));
    const client = new LidarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://lidarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const raw = await client.fetchRawItems();

    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      arrId: 3,
      title: "Polarnacht",
      mediaType: "audio",
      expectedAuthor: "Nordlicht",
      year: null,
      imdbId: null,
      germanTitle: null,
      aliases: null,
    });

    const derived = await client.deriveItems(raw);

    expect(derived).toHaveLength(1);
    expect(derived[0]?.expectedTitle).toBe("Polarnacht");
    expect(derived[0]?.expectedAuthor).toBe("Nordlicht");
    expect(derived[0]?.externalId).toBe(raw[0]?.externalId);
  });
});
