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

  it("skips corrupt rows without throwing and warns once with counts", async () => {
    const state = new AppState();
    const warn = vi.fn();
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
      dbRow(),
      dbRow({ id: "s2", externalId: "43", titleSearchVariations: "{bad" }),
    ]);
    await expect(state.reindexInstance("inst1")).resolves.toBeUndefined();

    expect(state.getByExternalId("tv", "42")?.externalId).toBe("42");
    expect(state.getByExternalId("tv", "43")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const [warnPayload, warnMessage] = warn.mock.calls[0] as [
      { skipped: number; total: number; samples: { rowId: string; error: string }[] },
      string,
    ];
    expect(warnMessage).toBe("search-item index: skipped corrupt rows");
    expect(warnPayload.skipped).toBe(1);
    expect(warnPayload.total).toBe(2);
    expect(warnPayload.samples).toHaveLength(1);
    expect(warnPayload.samples[0]?.rowId).toBe("s2");
    expect(warnPayload.samples[0]?.error.length).toBeGreaterThan(0);
  });

  it("indexes a valid row that comes after a corrupt row (does not stop on first error)", async () => {
    const state = new AppState();
    mockSearchItem.findMany.mockResolvedValueOnce([
      dbRow({ id: "sBad", externalId: "43", titleSearchVariations: "{bad" }),
      dbRow(),
    ]);
    await state.reindexInstance("inst1");

    expect(state.getByExternalId("tv", "43")).toBeNull();
    expect(state.getByExternalId("tv", "42")?.externalId).toBe("42");
  });
});
