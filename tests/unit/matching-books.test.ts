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
  // wrapper - the inner brackets come from the release name.
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

  describe("album title that is (part of) the artist's name", () => {
    // Album "Michael" by Michael Jackson, "Andrea" / "Bocelli" by Andrea
    // Bocelli, "ALICIA" by Alicia Keys: the title must not be found inside
    // the artist's name, or every release of the artist is renamed to it.
    const michael = {
      expectedAuthor: "Michael Jackson",
      expectedTitle: "Michael",
      titleMatchVariations: ["Michael"],
      authorMatchVariations: ["Michael Jackson"],
    };

    it.each([
      "Michael Jackson - Thriller (1982) FLAC",
      "Michael.Jackson-Thriller-LP-FLAC-1982-GROUP",
      "Michael_Jackson-Got_to_Be_There-1972-GROUP",
    ])("does not rename %s to album Michael", (release) => {
      expect(renameForBooksAndAudio(release, michael).rewrittenTitle).toBeNull();
    });

    it("still renames the self-titled release itself", () => {
      expect(
        renameForBooksAndAudio("Michael Jackson - Michael (2010) FLAC", michael).rewrittenTitle,
      ).toBe("Michael Jackson - Michael-[(2010) FLAC]");
    });

    it.each(["Andrea", "Bocelli"])("does not rename Duets to album %s", (album) => {
      const result = renameForBooksAndAudio("Andrea Bocelli - Duets (2024) FLAC", {
        expectedAuthor: "Andrea Bocelli",
        expectedTitle: album,
        titleMatchVariations: [album],
        authorMatchVariations: ["Andrea Bocelli"],
      });
      expect(result.rewrittenTitle).toBeNull();
    });

    it("ignores every occurrence of the artist's name, not only the first", () => {
      const result = renameForBooksAndAudio("Alicia Keys - Alicia Keys - Unplugged MP3", {
        expectedAuthor: "Alicia Keys",
        expectedTitle: "ALICIA",
        titleMatchVariations: ["ALICIA"],
        authorMatchVariations: ["Alicia Keys"],
      });
      expect(result.rewrittenTitle).toBeNull();
    });

    it("still renames a self-titled album that is also an artist variation", () => {
      // "Specials" is both the album and an author variation of The Specials
      // (article dropped): only a LONGER occurrence of the name rules it out.
      const result = renameForBooksAndAudio("The Specials - Specials (1979) FLAC", {
        expectedAuthor: "The Specials",
        expectedTitle: "Specials",
        titleMatchVariations: ["Specials"],
        authorMatchVariations: ["The Specials", "Specials"],
      });
      expect(result.rewrittenTitle).toBe("The Specials - Specials-[(1979) FLAC]");
    });

    it("still finds a title that merely starts with the artist's name", () => {
      const result = renameForBooksAndAudio("Kiss-Kissin Time-CD-FLAC-1974-GROUP", {
        expectedAuthor: "Kiss",
        expectedTitle: "Kissin’ Time",
        titleMatchVariations: ["Kissin Time"],
        authorMatchVariations: ["Kiss"],
      });
      expect(result.rewrittenTitle).toBe("Kiss - Kissin’ Time-[CD-FLAC-1974-GROUP]");
    });
  });

  describe("whole words only", () => {
    // An author or title found inside another word must not count: "Usher"
    // in "Crushers", "Rage" in "Outrageous", "Confidence" in "Overconfidence".
    function item(author: string, title: string, titleVariation = title) {
      return {
        expectedAuthor: author,
        expectedTitle: title,
        titleMatchVariations: [titleVariation],
        authorMatchVariations: [author],
      };
    }

    it.each([
      ["Hayley And The Crushers-Cool Lame-16BIT-WEB-FLAC-2018-GROUP", item("Usher", "A")],
      ["Unity Klan - Outrageous (2001) FLAC", item("Rage", "Unity")],
      ["The Hoosiers - Overconfidence (2024) FLAC", item("The Hoosiers", "Confidence")],
      ["Usher - Here I Stand (2008) FLAC", item("Usher", "“A”", "A")],
      ["R. Kelly-R. Kelly-WEB-2000-GRP", item("R. Kelly", "R.", "R")],
    ])("does not rename %s", (release, searchItem) => {
      expect(renameForBooksAndAudio(release, searchItem).rewrittenTitle).toBeNull();
    });

    it.each([
      [
        "Oomph!-Monster-DE-CD-FLAC-2008-GROUP",
        item("Oomph!", "Monster"),
        "Oomph! - Monster-[DE-CD-FLAC-2008-GROUP]",
      ],
      [
        "AC/DC-Back in Black-CD-FLAC-1980-GROUP",
        item("AC/DC", "Back in Black"),
        "AC/DC - Back in Black-[CD-FLAC-1980-GROUP]",
      ],
      [
        "Fischerspooner - #1 (2001) FLAC",
        item("Fischerspooner", "#1"),
        "Fischerspooner - #1-[(2001) FLAC]",
      ],
      ["Adele-21-WEB-2011-GROUP", item("Adele", "21"), "Adele - 21-[WEB-2011-GROUP]"],
    ])("still renames %s", (release, searchItem, expected) => {
      expect(renameForBooksAndAudio(release, searchItem).rewrittenTitle).toBe(expected);
    });

    it.each([
      ["Die Band - Heiß Onne (2000) FLAC", "Sonne"], // starts on the 2nd "s" of ß -> "ss"
      ["Die Band - Groß Stadt (2000) FLAC", "Gros"], // ends on the 1st "s" of ß -> "ss"
    ])("does not match inside an expanded character: %s / %s", (release, title) => {
      expect(renameForBooksAndAudio(release, item("Die Band", title)).rewrittenTitle).toBeNull();
    });

    it("still matches a whole word with an expanded character", () => {
      expect(
        renameForBooksAndAudio("Die Band - Straße (2000) FLAC", item("Die Band", "Straße"))
          .rewrittenTitle,
      ).toBe("Die Band - Straße-[(2000) FLAC]");
    });

    it("keeps a separate combining mark with its letter", () => {
      // Decomposed "u" + U+0308 as some indexers post it; the mark is neither a
      // separator nor the end of the word.
      const result = renameForBooksAndAudio("Einstürzende Neubauten - Kassetten [2006] flac", {
        expectedAuthor: "Einstürzende Neubauten",
        expectedTitle: "Kassetten",
        titleMatchVariations: ["Kassetten"],
        authorMatchVariations: ["Einstürzende Neubauten", "Einstuerzende Neubauten"],
      });
      expect(result.rewrittenTitle).toBe("Einstürzende Neubauten - Kassetten-[[2006] flac]");
      expect(
        renameForBooksAndAudio("Die Band - Café (2000) FLAC", item("Die Band", "Café"))
          .rewrittenTitle,
      ).toBe("Die Band - Café-[(2000) FLAC]");
    });

    it("treats underscores and dots as word boundaries", () => {
      const result = renameForBooksAndAudio("Boehse_Onkelz-Weiss-DE-CD-FLAC-1993-GROUP", {
        expectedAuthor: "Böhse Onkelz",
        expectedTitle: "Weiß",
        titleMatchVariations: ["Weiß", "Weiss"],
        authorMatchVariations: ["Böhse Onkelz", "Boehse Onkelz", "Bohse Onkelz"],
      });
      expect(result.rewrittenTitle).toBe("Böhse Onkelz - Weiß-[DE-CD-FLAC-1993-GROUP]");
    });
  });
});
