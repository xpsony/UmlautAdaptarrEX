import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { ListenarrClient } from "@/arr/listenarr";

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => data,
      text: async () => JSON.stringify(data),
    },
  };
}

const OPTS = {
  instanceId: "i",
  instanceName: "n",
  host: "http://listenarr.local",
  apiKey: "listenarr-key",
  userAgent: "UA",
};

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  requestMock.mockReset();
});

describe("ListenarrClient.fetchRawItems", () => {
  it("reads the flat library in a single request with header auth", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([{ id: 7, title: "Sunken Bells", authors: ["Marla Ostrand"], series: null }]),
    );

    const items = await new ListenarrClient(OPTS).fetchRawItems();

    expect(requestMock).toHaveBeenCalledTimes(1);
    const url = requestMock.mock.calls[0]?.[0] as string;
    const args = requestMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(url).toContain("/api/v1/library");
    expect(args.headers["X-Api-Key"]).toBe("listenarr-key");
    expect(url).not.toContain("listenarr-key");

    expect(items).toHaveLength(1);
    expect(items[0]?.arrId).toBe(7);
    expect(items[0]?.title).toBe("Sunken Bells");
    expect(items[0]?.expectedAuthor).toBe("Marla Ostrand");
    expect(items[0]?.mediaType).toBe("book");
  });

  it("keys the item the way Listenarr builds its query without a series", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([{ id: 7, title: "Sunken Bells", authors: ["Marla Ostrand"] }]),
    );

    const items = await new ListenarrClient(OPTS).fetchRawItems();

    expect(items[0]?.externalId).toBe("Sunken Bells Marla Ostrand");
    expect(items[0]?.externalIdAliases).toBeNull();
  });

  it("adds the series spelling as an alias when the audiobook has one", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 7,
          title: "Sunken Bells",
          authors: ["Marla Ostrand"],
          series: "Tidewater Chronicles",
        },
      ]),
    );

    const items = await new ListenarrClient(OPTS).fetchRawItems();

    expect(items[0]?.externalId).toBe("Sunken Bells Marla Ostrand");
    expect(items[0]?.externalIdAliases).toEqual([
      "Sunken Bells Marla Ostrand Tidewater Chronicles",
    ]);
  });

  it("uses the first author, the one Listenarr puts in its query", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([{ id: 7, title: "Sunken Bells", authors: ["Marla Ostrand", "Cory Vandehey"] }]),
    );

    const items = await new ListenarrClient(OPTS).fetchRawItems();
    expect(items[0]?.expectedAuthor).toBe("Marla Ostrand");
  });

  it("skips audiobooks without a title or without an author", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        { id: 1, title: "", authors: ["Marla Ostrand"] },
        { id: 2, title: "Sunken Bells", authors: [] },
        { id: 3, title: "Winter Lanterns", authors: null },
        { id: 4, title: "Paper Harbour", authors: ["Cory Vandehey"] },
      ]),
    );

    const items = await new ListenarrClient(OPTS).fetchRawItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Paper Harbour");
  });

  it("returns an empty list when the library call fails", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ error: "nope" }, 401));
    const items = await new ListenarrClient(OPTS).fetchRawItems();
    expect(items).toEqual([]);
  });
});

describe("ListenarrClient.fetchAllItems", () => {
  it("derives book variations with the author, like Readarr", async () => {
    requestMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 7,
          title: "Brückenkopf",
          authors: ["Marla Ostrand"],
          series: "Tidewater Chronicles",
        },
      ]),
    );

    const items = await new ListenarrClient(OPTS).fetchAllItems();

    expect(items).toHaveLength(1);
    expect(items[0]?.mediaType).toBe("book");
    expect(items[0]?.expectedTitle).toBe("Brückenkopf");
    expect(items[0]?.authorMatchVariations.length).toBeGreaterThan(0);
    expect(items[0]?.titleMatchVariations).toContain("Brueckenkopf");
    expect(items[0]?.externalIdAliases).toEqual(["Brückenkopf Marla Ostrand Tidewater Chronicles"]);
  });
});
