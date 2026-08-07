import { describe, expect, it } from "vitest";
import { diffTitleTokens, type TitleDiffSegment } from "@/lib/title-diff";

/** Reassemble the line a renderer shows for the original title. */
function originalLine(segments: TitleDiffSegment[]): string {
  return segments
    .filter((s) => s.kind !== "added")
    .map((s) => s.text)
    .join("");
}

/** Reassemble the line a renderer shows for the rewritten title. */
function rewrittenLine(segments: TitleDiffSegment[]): string {
  return segments
    .filter((s) => s.kind !== "removed")
    .map((s) => s.text)
    .join("");
}

describe("diffTitleTokens", () => {
  it("marks a single replaced token (umlaut swap)", () => {
    const original = "Maerchenwald.2026.German.EAC3.WEBRiP.x265-FEEN";
    const rewritten = "Märchenwald.2026.German.EAC3.WEBRiP.x265-FEEN";
    const segments = diffTitleTokens(original, rewritten);
    expect(segments.filter((s) => s.kind === "removed")).toEqual([
      { text: "Maerchenwald", kind: "removed" },
    ]);
    expect(segments.filter((s) => s.kind === "added")).toEqual([
      { text: "Märchenwald", kind: "added" },
    ]);
    expect(originalLine(segments)).toBe(original);
    expect(rewrittenLine(segments)).toBe(rewritten);
  });

  it("marks a token that only gained a suffix (colon insertion)", () => {
    const original = "Weltraumwacht.Zeltron.Neue.Welten.3099.S01E04";
    const rewritten = "Weltraumwacht.Zeltron:.Neue.Welten.3099.S01E04";
    const segments = diffTitleTokens(original, rewritten);
    expect(segments.filter((s) => s.kind === "removed")).toEqual([
      { text: "Zeltron", kind: "removed" },
    ]);
    expect(segments.filter((s) => s.kind === "added")).toEqual([
      { text: "Zeltron:", kind: "added" },
    ]);
    expect(originalLine(segments)).toBe(original);
    expect(rewrittenLine(segments)).toBe(rewritten);
  });

  it("handles multiple change regions independently", () => {
    const segments = diffTitleTokens("A.Foo.B.Bar", "A.Foo2.B.Bar2");
    expect(segments.filter((s) => s.kind === "removed")).toEqual([
      { text: "Foo", kind: "removed" },
      { text: "Bar", kind: "removed" },
    ]);
    expect(segments.filter((s) => s.kind === "added")).toEqual([
      { text: "Foo2", kind: "added" },
      { text: "Bar2", kind: "added" },
    ]);
    expect(originalLine(segments)).toBe("A.Foo.B.Bar");
    expect(rewrittenLine(segments)).toBe("A.Foo2.B.Bar2");
    for (let k = 1; k < segments.length; k++) {
      expect(segments[k]!.kind).not.toBe(segments[k - 1]!.kind);
    }
  });

  it("returns a single same segment for identical titles", () => {
    expect(diffTitleTokens("Same.Title.2026", "Same.Title.2026")).toEqual([
      { text: "Same.Title.2026", kind: "same" },
    ]);
  });

  it("handles empty strings", () => {
    expect(diffTitleTokens("", "")).toEqual([]);
    expect(diffTitleTokens("", "X.Y")).toEqual([{ text: "X.Y", kind: "added" }]);
    expect(diffTitleTokens("X.Y", "")).toEqual([{ text: "X.Y", kind: "removed" }]);
  });

  it("falls back to whole-string segments above the token cap", () => {
    const original = Array.from({ length: 600 }, (_, i) => `t${i}`).join(".");
    const rewritten = original.replace("t0.", "x0.");
    const segments = diffTitleTokens(original, rewritten);
    expect(segments).toEqual([
      { text: original, kind: "removed" },
      { text: rewritten, kind: "added" },
    ]);
  });

  it("marks a separator change as removed/added", () => {
    const segments = diffTitleTokens("Alpha.Beta", "Alpha Beta");
    expect(segments.filter((s) => s.kind === "removed")).toEqual([{ text: ".", kind: "removed" }]);
    expect(segments.filter((s) => s.kind === "added")).toEqual([{ text: " ", kind: "added" }]);
    expect(originalLine(segments)).toBe("Alpha.Beta");
    expect(rewrittenLine(segments)).toBe("Alpha Beta");
  });
});
