import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSearchItem, mockArrInstance } = vi.hoisted(() => ({
  mockSearchItem: { findMany: vi.fn() },
  mockArrInstance: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    searchItem: mockSearchItem,
    arrInstance: mockArrInstance,
  },
}));

import { AppState } from "@/server/state";

beforeEach(() => {
  mockSearchItem.findMany.mockReset();
  mockArrInstance.findMany.mockReset();
  mockArrInstance.findMany.mockResolvedValue([]);
});

afterEach(() => {
  mockSearchItem.findMany.mockReset();
  mockArrInstance.findMany.mockReset();
});

describe("AppState default state", () => {
  it("starts with NO_SETTINGS sentinel values", () => {
    const state = new AppState();
    expect(state.settings.appApiKey).toBe("");
    expect(state.settings.proxyPort).toBe(5006);
    expect(state.settings.setupComplete).toBe(false);
    expect(state.settings.operationMode).toBe("proxy");
  });

  it("has no provider before reloadSettings runs", () => {
    expect(new AppState().provider).toBeNull();
  });

  it("starts with neither tmdb nor tvdb available", () => {
    const state = new AppState();
    expect(state.tmdbAvailable).toBe(false);
    expect(state.tvdbAvailable).toBe(false);
  });

  it("languagePack defaults to the aggregate of default-enabled plugins", () => {
    const pack = new AppState().languagePack;
    expect(pack).toBeDefined();
    expect(Array.isArray(pack.activePlugins)).toBe(true);
  });

  it("providerForOrder returns null when no build options have been seeded", () => {
    expect(new AppState().providerForOrder(["pcjones"])).toBeNull();
  });

  it("setLogger does not throw and is a no-op for query-side state", () => {
    const state = new AppState();
    const fakeLogger = {
      child: () => fakeLogger,
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
    } as never;
    expect(() => state.setLogger(fakeLogger)).not.toThrow();
  });
});

describe("AppState.loadSearchItemsFromDb", () => {
  it("hydrates the in-memory index from persisted rows", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([
      {
        id: "row1",
        arrInstanceId: "inst-1",
        arrId: 5,
        externalId: "100",
        title: "Show",
        expectedTitle: "Show",
        expectedAuthor: null,
        germanTitle: "Sendung",
        mediaType: "tv",
        year: null,
        titleSearchVariations: '["Show"]',
        titleMatchVariations: '["Show","Sendung"]',
        authorMatchVariations: "[]",
      },
    ]);

    const state = new AppState();
    await state.loadSearchItemsFromDb();

    const item = state.getByExternalId("tv", "100");
    expect(item?.title).toBe("Show");
    expect(item?.titleMatchVariations).toEqual(["Show", "Sendung"]);
  });

  it("clears existing index entries before re-loading", async () => {
    const state = new AppState();
    state.indexItem({
      id: "old",
      arrInstanceId: "i",
      arrId: 1,
      externalId: "stale",
      title: "Stale",
      expectedTitle: "Stale",
      expectedAuthor: null,
      germanTitle: null,
      mediaType: "tv",
      year: null,
      titleSearchVariations: [],
      titleMatchVariations: ["Stale"],
      authorMatchVariations: [],
    });
    expect(state.getByExternalId("tv", "stale")).not.toBeNull();

    mockSearchItem.findMany.mockResolvedValueOnce([]);
    await state.loadSearchItemsFromDb();
    expect(state.getByExternalId("tv", "stale")).toBeNull();
  });

  it("requests only the columns toCachedSearchItem needs (no full-row fetch)", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([]);
    const state = new AppState();
    await state.loadSearchItemsFromDb();

    expect(mockSearchItem.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        arrInstanceId: true,
        arrId: true,
        externalId: true,
        title: true,
        expectedTitle: true,
        expectedAuthor: true,
        germanTitle: true,
        mediaType: true,
        year: true,
        titleSearchVariations: true,
        titleMatchVariations: true,
        authorMatchVariations: true,
      },
    });
  });

  it("skips corrupt rows, indexes the valid ones, and warns once with counts", async () => {
    const warn = vi.fn();
    const state = new AppState();
    state.setLogger({
      child: () => ({}) as never,
      info: () => {},
      warn,
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
    } as never);

    mockSearchItem.findMany.mockResolvedValueOnce([
      {
        id: "row1",
        arrInstanceId: "inst-1",
        arrId: 5,
        externalId: "100",
        title: "Show",
        expectedTitle: "Show",
        expectedAuthor: null,
        germanTitle: "Sendung",
        mediaType: "tv",
        year: null,
        titleSearchVariations: '["Show"]',
        titleMatchVariations: '["Show","Sendung"]',
        authorMatchVariations: "[]",
      },
      {
        id: "row2",
        arrInstanceId: "inst-1",
        arrId: 6,
        externalId: "200",
        title: "Broken",
        expectedTitle: "Broken",
        expectedAuthor: null,
        germanTitle: null,
        mediaType: "tv",
        year: null,
        titleSearchVariations: "{bad",
        titleMatchVariations: '["Broken"]',
        authorMatchVariations: "[]",
      },
    ]);

    await expect(state.loadSearchItemsFromDb()).resolves.toBeUndefined();

    expect(state.getByExternalId("tv", "100")).not.toBeNull();
    expect(state.getByExternalId("tv", "200")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const [warnPayload, warnMessage] = warn.mock.calls[0] as [
      { skipped: number; total: number; samples: { rowId: string; error: string }[] },
      string,
    ];
    expect(warnMessage).toBe("search-item index: skipped corrupt rows");
    expect(warnPayload.skipped).toBe(1);
    expect(warnPayload.total).toBe(2);
    expect(warnPayload.samples).toHaveLength(1);
    expect(warnPayload.samples[0]?.rowId).toBe("row2");
    expect(warnPayload.samples[0]?.error.length).toBeGreaterThan(0);
  });

  it("indexes a valid row that comes after a corrupt row (does not stop on first error)", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([
      {
        id: "rowBad",
        arrInstanceId: "inst-1",
        arrId: 6,
        externalId: "200",
        title: "Broken",
        expectedTitle: "Broken",
        expectedAuthor: null,
        germanTitle: null,
        mediaType: "tv",
        year: null,
        titleSearchVariations: "{bad",
        titleMatchVariations: '["Broken"]',
        authorMatchVariations: "[]",
      },
      {
        id: "rowGood",
        arrInstanceId: "inst-1",
        arrId: 5,
        externalId: "100",
        title: "Show",
        expectedTitle: "Show",
        expectedAuthor: null,
        germanTitle: "Sendung",
        mediaType: "tv",
        year: null,
        titleSearchVariations: '["Show"]',
        titleMatchVariations: '["Show","Sendung"]',
        authorMatchVariations: "[]",
      },
    ]);

    const state = new AppState();
    await state.loadSearchItemsFromDb();

    expect(state.getByExternalId("tv", "200")).toBeNull();
    expect(state.getByExternalId("tv", "100")).not.toBeNull();
  });

  it("does not warn when no rows are corrupt", async () => {
    const warn = vi.fn();
    const state = new AppState();
    state.setLogger({
      child: () => ({}) as never,
      info: () => {},
      warn,
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
    } as never);

    mockSearchItem.findMany.mockResolvedValueOnce([
      {
        id: "row1",
        arrInstanceId: "inst-1",
        arrId: 5,
        externalId: "100",
        title: "Show",
        expectedTitle: "Show",
        expectedAuthor: null,
        germanTitle: "Sendung",
        mediaType: "tv",
        year: null,
        titleSearchVariations: '["Show"]',
        titleMatchVariations: '["Show","Sendung"]',
        authorMatchVariations: "[]",
      },
    ]);

    await state.loadSearchItemsFromDb();
    expect(warn).not.toHaveBeenCalled();
  });
});
