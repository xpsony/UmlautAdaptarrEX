import { describe, expect, it } from "vitest";
import { groupConsecutiveRenames } from "@/lib/rename-grouping";

interface TestRow {
  mediaType: string;
  originalTitle: string;
  rewrittenTitle: string;
  createdAt: string;
}

function row(overrides: Partial<TestRow> = {}): TestRow {
  return {
    mediaType: "tv",
    originalTitle: "Foo.S01E01",
    rewrittenTitle: "Föö.S01E01",
    createdAt: "2026-08-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("groupConsecutiveRenames", () => {
  it("collapses consecutive identical triples and tracks the time range", () => {
    // API default order: createdAt desc → newest first.
    const items = [
      row({ createdAt: "2026-08-07T12:31:00.000Z" }),
      row({ createdAt: "2026-08-07T12:16:00.000Z" }),
      row({ createdAt: "2026-08-07T12:00:00.000Z" }),
    ];
    const groups = groupConsecutiveRenames(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.item).toBe(items[0]);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.firstAt).toBe("2026-08-07T12:00:00.000Z");
    expect(groups[0]!.lastAt).toBe("2026-08-07T12:31:00.000Z");
  });

  it("tracks the time range under ascending sort order too", () => {
    const items = [
      row({ createdAt: "2026-08-07T12:00:00.000Z" }),
      row({ createdAt: "2026-08-07T12:16:00.000Z" }),
      row({ createdAt: "2026-08-07T12:31:00.000Z" }),
    ];
    const groups = groupConsecutiveRenames(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.item).toBe(items[0]);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.firstAt).toBe("2026-08-07T12:00:00.000Z");
    expect(groups[0]!.lastAt).toBe("2026-08-07T12:31:00.000Z");
  });

  it("breaks the run when only the mediaType differs", () => {
    const items = [row(), row({ mediaType: "movie" }), row()];
    expect(groupConsecutiveRenames(items).map((g) => g.count)).toEqual([1, 1, 1]);
  });

  it("keeps non-adjacent duplicates separate", () => {
    const items = [row(), row({ originalTitle: "Bar", rewrittenTitle: "Bär" }), row()];
    const groups = groupConsecutiveRenames(items);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.item)).toEqual(items);
  });

  it("returns an empty array for an empty page", () => {
    expect(groupConsecutiveRenames([])).toEqual([]);
  });
});
