import { describe, expect, it } from "vitest";
import { renameForBooksAndAudio } from "@/domain/matching/books-audio.js";

describe("renameForBooksAndAudio", () => {
  it("rewrites with author + title format", () => {
    const result = renameForBooksAndAudio(
      "Die.Wölfe.Best.of.Best.of.MP3.320kbps",
      {
        expectedAuthor: "Die Wölfe",
        expectedTitle: "Best of",
        titleMatchVariations: ["Best of"],
        authorMatchVariations: ["Die Wölfe", "Die Woelfe", "Die Wolfe"],
      },
    );
    expect(result.rewrittenTitle).toMatch(/^Die Wölfe - Best of/);
    expect(result.rewrittenTitle).toContain("[");
  });

  it("appends suffix only if length >= 3", () => {
    const result = renameForBooksAndAudio("Die.Wölfe.Best.of.Q", {
      expectedAuthor: "Die Wölfe",
      expectedTitle: "Best of",
      titleMatchVariations: ["Best of"],
      authorMatchVariations: ["Die Wölfe"],
    });
    expect(result.rewrittenTitle).toBe("Die Wölfe - Best of");
  });

  it("returns null when author or title not found", () => {
    const result = renameForBooksAndAudio("Some.Other.Album.MP3", {
      expectedAuthor: "Die Wölfe",
      expectedTitle: "Best of",
      titleMatchVariations: ["Best of"],
      authorMatchVariations: ["Die Wölfe"],
    });
    expect(result.rewrittenTitle).toBeNull();
  });

  it("does not let a stray short variation pull endPos into the suffix", () => {
    // Without the longest-match-per-list fix, the bare "M" variation
    // would `indexOf` later in the title (inside "MP3") and bestEnd
    // would jump past the trailing tags, swallowing "[MP3.German]".
    const result = renameForBooksAndAudio("Anna.Marx.Echo.MP3.German.320kbps", {
      expectedAuthor: "Anna Marx",
      expectedTitle: "Echo",
      titleMatchVariations: ["Echo"],
      authorMatchVariations: ["Anna Marx", "M"],
    });
    expect(result.rewrittenTitle).toBe("Anna Marx - Echo-[MP3.German.320kbps]");
  });

  it("counts unmapped accents toward the matched span", () => {
    // German plugin is default; "é" in the original still normalizes
    // to "e" via NFD. The walk must credit 1 normalized char so that
    // the span end lands at the right boundary.
    const result = renameForBooksAndAudio("Café.Brulé.MP3.German", {
      expectedAuthor: "Cafe",
      expectedTitle: "Brule",
      titleMatchVariations: ["Brule"],
      authorMatchVariations: ["Cafe"],
    });
    expect(result.rewrittenTitle).toBe("Cafe - Brule-[MP3.German]");
  });

  // The outer "[...]" in the expectations below is the formatter's own suffix
  // wrapper — the inner brackets come from the release name.
  it("skips a trailing closing paren before the quality tag", () => {
    // The matched variation carries no parentheses, so the span ends on '5'
    // and the ")" used to leak into the suffix as "-[) [MP3-128kbps]]".
    const result = renameForBooksAndAudio(
      "Jane Doe - Deep Water (2005) [MP3-128kbps]",
      {
        expectedAuthor: "Jane Doe",
        expectedTitle: "Tiefes Wasser",
        titleMatchVariations: ["Deep Water (2005)", "Deep Water 2005"],
        authorMatchVariations: ["Jane Doe"],
      },
    );
    expect(result.rewrittenTitle).toBe(
      "Jane Doe - Tiefes Wasser-[[MP3-128kbps]]",
    );
  });

  it("does not swallow an opening bracket that starts the quality tag", () => {
    // Counterpart to the paren skip: with no separator between title and tag,
    // consuming the "[" would drop it from the suffix and emit an unbalanced
    // "-[MP3-128kbps]]".
    const result = renameForBooksAndAudio("Jane Doe - Deep Water[MP3-128kbps]", {
      expectedAuthor: "Jane Doe",
      expectedTitle: "Tiefes Wasser",
      titleMatchVariations: ["Deep Water"],
      authorMatchVariations: ["Jane Doe"],
    });
    expect(result.rewrittenTitle).toBe(
      "Jane Doe - Tiefes Wasser-[[MP3-128kbps]]",
    );
  });
});
