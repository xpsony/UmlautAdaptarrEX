import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { ReadarrClient } from "@/arr/readarr";

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

describe("ReadarrClient.fetchAllItems", () => {
  it("strips the author prefix from book titles", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, authorName: "Gregory P. Stark" }]))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 10,
            authorId: 1,
            title: "Gregory P. Stark: A Crown of Ravens",
          },
        ]),
      );

    const client = new ReadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://readarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const items = await client.fetchAllItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("A Crown of Ravens");
  });

  it("trims at the first parenthesis", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, authorName: "Author" }]))
      .mockResolvedValueOnce(
        jsonResponse([{ id: 10, authorId: 1, title: "Some Book (German Edition)" }]),
      );

    const client = new ReadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://readarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const items = await client.fetchAllItems();
    expect(items[0]?.title).toBe("Some Book");
  });

  it("trims at the first colon when the colon is not the author prefix", async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, authorName: "Author" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 10, authorId: 1, title: "Title: Subtitle" }]));

    const client = new ReadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://readarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const items = await client.fetchAllItems();
    expect(items[0]?.title).toBe("Title");
  });

  it("returns an empty array when the upstream is unreachable", async () => {
    requestMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const client = new ReadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://readarr.local",
      apiKey: "k",
      userAgent: "UA",
    });
    expect(await client.fetchAllItems()).toEqual([]);
  });

  it("derives externalId from '{book} {author}' so same-titled books across authors do not collide", async () => {
    // Matches ReadarrClient.cs in the .NET predecessor:
    //   var expectedTitle = $"{bookTitle} {authorName}";
    //   var externalId   = expectedTitle.GetReadarrTitleForExternalId();
    requestMock
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 1, authorName: "Stephen King" },
          { id: 2, authorName: "Joe Hill" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 10, authorId: 1, title: "The Fireman" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 20, authorId: 2, title: "The Fireman" }]));

    const client = new ReadarrClient({
      instanceId: "i",
      instanceName: "n",
      host: "http://readarr.local",
      apiKey: "k",
      userAgent: "UA",
    });

    const items = await client.fetchAllItems();
    expect(items).toHaveLength(2);
    const externalIds = items.map((i) => i.externalId);
    expect(new Set(externalIds).size).toBe(2);
    // getReadarrTitleForExternalId strips "the " and collapses separators.
    // Result for "The Fireman Stephen King" → "Fireman Stephen King".
    expect(externalIds).toContain("Fireman Stephen King");
    expect(externalIds).toContain("Fireman Joe Hill");
  });
});
