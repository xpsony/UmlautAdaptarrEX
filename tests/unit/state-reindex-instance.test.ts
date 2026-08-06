import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSearchItem } = vi.hoisted(() => ({
  mockSearchItem: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: { searchItem: mockSearchItem },
}));

import { AppState } from "@/server/state";

function dbRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    arrInstanceId: "inst1",
    arrId: 1,
    externalId: "42",
    title: "Dark",
    expectedTitle: "Dark",
    expectedAuthor: null,
    germanTitle: "Dunkel",
    mediaType: "tv",
    year: 2017,
    titleSearchVariations: JSON.stringify(["Dunkel"]),
    titleMatchVariations: JSON.stringify(["Dunkel", "Dark"]),
    authorMatchVariations: JSON.stringify([]),
    aliases: null,
    updatedAt: new Date(0),
    ...over,
  };
}

describe("AppState.reindexInstance", () => {
  beforeEach(() => {
    mockSearchItem.findMany.mockReset();
  });

  it("replaces the instance's items with fresh DB state", async () => {
    const state = new AppState();
    mockSearchItem.findMany.mockResolvedValueOnce([dbRow()]);
    await state.reindexInstance("inst1");
    expect(state.getByExternalId("tv", "42")?.germanTitle).toBe("Dunkel");

    // Second reindex returns an updated row — the old index entry must be gone.
    mockSearchItem.findMany.mockResolvedValueOnce([
      dbRow({ germanTitle: "Finster", titleMatchVariations: JSON.stringify(["Finster"]) }),
    ]);
    await state.reindexInstance("inst1");
    expect(state.getByExternalId("tv", "42")?.germanTitle).toBe("Finster");
    expect(mockSearchItem.findMany).toHaveBeenLastCalledWith({
      where: { arrInstanceId: "inst1" },
    });
  });

  it("does not touch items of other instances", async () => {
    const state = new AppState();
    mockSearchItem.findMany.mockResolvedValueOnce([dbRow()]);
    await state.reindexInstance("inst1");
    mockSearchItem.findMany.mockResolvedValueOnce([]);
    await state.reindexInstance("inst2");
    expect(state.getByExternalId("tv", "42")).not.toBeNull();
  });

  // Regression guard for the title-prefix bucket (byTitlePrefix), which is a
  // list keyed by normalized-title prefix rather than a single-key Map. A
  // reindexInstance that forgot removeItemsForInstance() would leave the
  // stale "Dunkel" variation matchable forever alongside the fresh "Finster"
  // one — getByExternalId alone (a Map overwrite) can't detect that leak.
  it("drops stale title-match variations so findByTitle stops matching the old title", async () => {
    const state = new AppState();
    mockSearchItem.findMany.mockResolvedValueOnce([
      dbRow({ titleMatchVariations: JSON.stringify(["Dunkel"]) }),
    ]);
    await state.reindexInstance("inst1");
    expect(state.findByTitle("tv", "Dunkel S01E01 Pilot")?.externalId).toBe("42");

    mockSearchItem.findMany.mockResolvedValueOnce([
      dbRow({ titleMatchVariations: JSON.stringify(["Finster"]) }),
    ]);
    await state.reindexInstance("inst1");

    expect(state.findByTitle("tv", "Dunkel S01E01 Pilot")).toBeNull();
    expect(state.findByTitle("tv", "Finster S01E01 Pilot")?.externalId).toBe("42");
  });
});
