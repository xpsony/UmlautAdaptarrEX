import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSearchItem, mockOverride, mockCache, mockTx } = vi.hoisted(() => {
  const mockSearchItem = { findMany: vi.fn(), update: vi.fn() };
  return {
    mockSearchItem,
    mockOverride: { findUnique: vi.fn() },
    mockCache: { findUnique: vi.fn() },
    mockTx: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({ searchItem: mockSearchItem })),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    searchItem: mockSearchItem,
    titleOverride: mockOverride,
    titleApiCache: mockCache,
    $transaction: mockTx,
  },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: { reindexInstance: vi.fn() },
}));
vi.mock("@/server/state", () => ({ getAppState: () => mockState }));

import { rebuildSearchItemsFor } from "@/server/title-overrides/rebuild";

const row = {
  id: "s1",
  arrInstanceId: "inst1",
  arrId: 7,
  externalId: "42",
  title: "Dark",
  expectedTitle: "Dark",
  expectedAuthor: null,
  germanTitle: "Falscher Titel",
  mediaType: "tv",
  year: 2017,
  titleSearchVariations: "[]",
  titleMatchVariations: "[]",
  authorMatchVariations: "[]",
  aliases: null,
  updatedAt: new Date(0),
};

beforeEach(() => {
  mockSearchItem.findMany.mockReset();
  mockSearchItem.update.mockReset();
  mockOverride.findUnique.mockReset();
  mockCache.findUnique.mockReset();
  mockState.reindexInstance.mockReset();
  mockState.reindexInstance.mockResolvedValue(undefined);
});

describe("rebuildSearchItemsFor", () => {
  it("applies the override title and recomputes variations via the domain", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([row]);
    mockOverride.findUnique.mockResolvedValueOnce({
      mediaType: "tv",
      externalId: "42",
      germanTitle: "Dunkel Override",
    });
    mockCache.findUnique.mockResolvedValueOnce(null);

    const result = await rebuildSearchItemsFor("tv", "42");

    expect(result.rebuiltItems).toBe(1);
    const update = mockSearchItem.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { germanTitle: string; titleSearchVariations: string };
    };
    expect(update.where).toEqual({ id: "s1" });
    expect(update.data.germanTitle).toBe("Dunkel Override");
    // Real domain output: the override title must appear in the recomputed variations.
    expect(JSON.parse(update.data.titleSearchVariations)).toContain("Dunkel Override");
    expect(mockState.reindexInstance).toHaveBeenCalledWith("inst1");
  });

  it("restores the cached provider title when no override exists", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([row]);
    mockOverride.findUnique.mockResolvedValueOnce(null);
    mockCache.findUnique.mockResolvedValueOnce({
      id: "tv:42",
      translations: [{ lang: "de", title: "Dunkel", aliasesJson: null }],
    });

    await rebuildSearchItemsFor("tv", "42");

    const update = mockSearchItem.update.mock.calls[0]![0] as {
      data: { germanTitle: string | null };
    };
    expect(update.data.germanTitle).toBe("Dunkel");
  });

  it("sets germanTitle to null when neither override nor cache exist", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([row]);
    mockOverride.findUnique.mockResolvedValueOnce(null);
    mockCache.findUnique.mockResolvedValueOnce(null);

    await rebuildSearchItemsFor("tv", "42");

    const update = mockSearchItem.update.mock.calls[0]![0] as {
      data: { germanTitle: string | null };
    };
    expect(update.data.germanTitle).toBeNull();
  });

  it("returns 0 and skips all writes when no items match", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([]);
    const result = await rebuildSearchItemsFor("tv", "999");
    expect(result.rebuiltItems).toBe(0);
    expect(mockSearchItem.update).not.toHaveBeenCalled();
    expect(mockState.reindexInstance).not.toHaveBeenCalled();
  });

  it("prefers the override over an existing cached de translation", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([row]);
    mockOverride.findUnique.mockResolvedValueOnce({
      mediaType: "tv",
      externalId: "42",
      germanTitle: "Dunkel Override",
    });
    mockCache.findUnique.mockResolvedValueOnce({
      id: "tv:42",
      translations: [{ lang: "de", title: "Dunkel Cache", aliasesJson: null }],
    });

    await rebuildSearchItemsFor("tv", "42");

    const update = mockSearchItem.update.mock.calls[0]![0] as {
      data: { germanTitle: string; titleSearchVariations: string };
    };
    expect(update.data.germanTitle).toBe("Dunkel Override");
    const variations = JSON.parse(update.data.titleSearchVariations) as string[];
    expect(variations).toContain("Dunkel Override");
    // Guards against both a swapped resolution order and dropping the
    // `titlesByLang["de"] = override.germanTitle` overwrite: either bug
    // would leak the cached title into the recomputed variations.
    expect(variations).not.toContain("Dunkel Cache");
  });

  it("treats a corrupt aliases column as null instead of throwing", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([{ ...row, aliases: "{not json" }]);
    mockOverride.findUnique.mockResolvedValueOnce({
      mediaType: "tv",
      externalId: "42",
      germanTitle: "Dunkel Override",
    });
    mockCache.findUnique.mockResolvedValueOnce(null);

    const result = await rebuildSearchItemsFor("tv", "42");

    expect(result.rebuiltItems).toBe(1);
    const update = mockSearchItem.update.mock.calls[0]![0] as {
      data: { aliases: string | null };
    };
    expect(update.data.aliases).toBeNull();
  });

  it("reindexes each distinct instance exactly once", async () => {
    mockSearchItem.findMany.mockResolvedValueOnce([
      row,
      { ...row, id: "s2", arrInstanceId: "inst2" },
    ]);
    mockOverride.findUnique.mockResolvedValueOnce({
      mediaType: "tv",
      externalId: "42",
      germanTitle: "Dunkel Override",
    });
    mockCache.findUnique.mockResolvedValueOnce(null);

    await rebuildSearchItemsFor("tv", "42");

    expect(mockState.reindexInstance).toHaveBeenCalledTimes(2);
    expect(mockState.reindexInstance).toHaveBeenCalledWith("inst1");
    expect(mockState.reindexInstance).toHaveBeenCalledWith("inst2");
  });
});
