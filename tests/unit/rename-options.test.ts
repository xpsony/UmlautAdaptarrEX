import { describe, expect, it } from "vitest";
import { renameForMoviesAndTv, stripReleaseUnsafeChars } from "@/domain/matching/rename";
import { renameForBooksAndAudio } from "@/domain/matching/books-audio";

// Settings -> Renaming. Every flag defaults to today's EX behaviour, so the
// "no options" case must stay byte-identical to what shipped before.

describe("stripReleaseUnsafeChars", () => {
  it("removes the characters release names never carry", () => {
    expect(stripReleaseUnsafeChars('a:b?c*d"e<f>g|h/i\\j')).toBe("abcdefghij");
  });

  it("collapses the doubled separator a stripped colon leaves behind", () => {
    expect(stripReleaseUnsafeChars("Ember:.Steel.Angel")).toBe("Ember.Steel.Angel");
  });

  it("trims a separator that ends up dangling at either end", () => {
    expect(stripReleaseUnsafeChars(":.Leading")).toBe("Leading");
    expect(stripReleaseUnsafeChars("Trailing.:")).toBe("Trailing");
  });

  it("leaves a clean title untouched", () => {
    expect(stripReleaseUnsafeChars("Realm.of.Ravens")).toBe("Realm.of.Ravens");
  });
});

describe("renameForMoviesAndTv: stripSpecialChars", () => {
  const item = {
    expectedTitle: "Ember: Steel Angel",
    titleMatchVariations: ["Ember Stahlengel"],
    year: null,
  };

  it("off (default) keeps the colon in the inserted title", () => {
    const r = renameForMoviesAndTv("Ember.Stahlengel.2019.GERMAN.1080p", item);
    expect(r.rewrittenTitle).toBe("Ember:.Steel.Angel.2019.GERMAN.1080p");
  });

  it("on strips the colon without doubling the separator", () => {
    const r = renameForMoviesAndTv("Ember.Stahlengel.2019.GERMAN.1080p", item, undefined, {
      stripSpecialChars: true,
    });
    expect(r.rewrittenTitle).toBe("Ember.Steel.Angel.2019.GERMAN.1080p");
  });

  it("leaves the indexer's own suffix verbatim", () => {
    const r = renameForMoviesAndTv("Ember.Stahlengel.2019.WEB-DL.x264-GRP", item, undefined, {
      stripSpecialChars: true,
    });
    expect(r.rewrittenTitle).toContain(".2019.WEB-DL.x264-GRP");
  });
});

describe("renameForMoviesAndTv: yearGuard", () => {
  const item = {
    expectedTitle: "GP - Der Film",
    titleMatchVariations: ["Grand Prix"],
    year: 2025,
  };

  it("on (default) refuses a release whose year is out of tolerance", () => {
    const r = renameForMoviesAndTv("Grand.Prix.2019.GERMAN.1080p", item);
    expect(r.rewrittenTitle).toBeNull();
    expect(r.reason).toBe("year-mismatch");
  });

  it("off rewrites anyway (legacy behaviour: no year check existed)", () => {
    const r = renameForMoviesAndTv("Grand.Prix.2019.GERMAN.1080p", item, undefined, {
      yearGuard: false,
    });
    expect(r.rewrittenTitle).toBe("GP.-.Der.Film.2019.GERMAN.1080p");
  });
});

describe("renameForMoviesAndTv: prefixGuard", () => {
  // expectedTitle starts with the matched variation and no SxxExx / year
  // follows - the EX guard refuses, the predecessor did not.
  const item = {
    expectedTitle: "Silberlicht: Ende der Reise",
    titleMatchVariations: ["Silberlicht"],
    year: null,
  };

  it("on (default) refuses the ambiguous prefix", () => {
    const r = renameForMoviesAndTv("Silberlicht.GERMAN.1080p.WEB", item);
    expect(r.rewrittenTitle).toBeNull();
    expect(r.reason).toBe("ambiguous-prefix");
  });

  it("off rewrites the ambiguous prefix", () => {
    const r = renameForMoviesAndTv("Silberlicht.GERMAN.1080p.WEB", item, undefined, {
      prefixGuard: false,
    });
    expect(r.rewrittenTitle).toBe("Silberlicht:.Ende.der.Reise.GERMAN.1080p.WEB");
  });

  it("on still rewrites when a strong release marker follows", () => {
    const r = renameForMoviesAndTv("Silberlicht.S01E01.GERMAN.1080p", item);
    expect(r.rewrittenTitle).toBe("Silberlicht:.Ende.der.Reise.S01E01.GERMAN.1080p");
  });
});

describe("renameForMoviesAndTv: releaseTagGuard", () => {
  // The alias carries a release tag the expectedTitle does not have.
  const item = {
    expectedTitle: "Nachtwache: Wiederkehr",
    titleMatchVariations: ["Nachtwache Wiederkehr 3D"],
    year: null,
  };

  it("on (default) pushes the 3D tag back into the suffix", () => {
    const r = renameForMoviesAndTv("Nachtwache.Wiederkehr.3D.2010.GERMAN", item);
    expect(r.rewrittenTitle).toContain(".3D.2010.GERMAN");
  });

  it("off swallows the tag, like the predecessor did", () => {
    const r = renameForMoviesAndTv("Nachtwache.Wiederkehr.3D.2010.GERMAN", item, undefined, {
      releaseTagGuard: false,
    });
    expect(r.rewrittenTitle).not.toContain(".3D.");
    expect(r.rewrittenTitle).toContain(".2010.GERMAN");
  });
});

describe("renameForMoviesAndTv: legacySuffix", () => {
  // The predecessor cut the suffix at the matched variation's RAW length and
  // had no token-boundary check. Both are one optimisation in EX, so the
  // toggle turns both off - otherwise the wrong cut point would be fed to the
  // boundary check and the toggle would just decline renames at random.
  const digitTailItem = {
    expectedTitle: "Die Renko Jagd",
    titleMatchVariations: ["Renko Jagd 2"],
    year: null,
  };
  const digitTailRelease = "Renko.Jagd.2016.GERMAN.DL.1080p";

  it("off (default) declines when the variation ends mid-token", () => {
    // Variation "Renko Jagd 2" normalizes into the start of
    // "Renko.Jagd.2016…" - the boundary check refuses rather than eating the
    // leading "2" of the year.
    const r = renameForMoviesAndTv(digitTailRelease, digitTailItem);
    expect(r.rewrittenTitle).toBeNull();
  });

  it("on reproduces the predecessor's mangled year", () => {
    const r = renameForMoviesAndTv(digitTailRelease, digitTailItem, undefined, {
      legacySuffix: true,
    });
    expect(r.rewrittenTitle).toBe("Die.Renko.Jagd.016.GERMAN.DL.1080p");
  });

  it("on and off agree when the raw cut happens to land on a boundary", () => {
    // "Strasse Test" is 12 raw chars and "Straße.Test." is 12 chars too (ß
    // expands to "ss" during normalization, the trailing "." absorbs the
    // difference), so both paths produce the same title here.
    const item = {
      expectedTitle: "Street Test",
      titleMatchVariations: ["Strasse Test"],
      year: null,
    };
    const original = "Straße.Test.S01E01.GERMAN.1080p";
    expect(
      renameForMoviesAndTv(original, item, undefined, { legacySuffix: true }).rewrittenTitle,
    ).toBe("Street.Test.S01E01.GERMAN.1080p");
    expect(renameForMoviesAndTv(original, item).rewrittenTitle).toBe(
      "Street.Test.S01E01.GERMAN.1080p",
    );
  });

  it("on and off agree for plain ASCII, where no character folds", () => {
    const item = {
      expectedTitle: "Realm of Ravens",
      titleMatchVariations: ["Lied der Schwarzen Raben"],
      year: null,
    };
    const original = "Lied.der.Schwarzen.Raben.S01E01.GERMAN";
    expect(
      renameForMoviesAndTv(original, item, undefined, { legacySuffix: true }).rewrittenTitle,
    ).toBe(renameForMoviesAndTv(original, item).rewrittenTitle);
  });
});

describe("renameForBooksAndAudio: stripSpecialChars", () => {
  const item = {
    expectedTitle: "Der kleine Drache: Hin und zurück",
    expectedAuthor: "A. B. Steinfeld",
    titleMatchVariations: ["Der Drachenjunge"],
    authorMatchVariations: ["Steinfeld"],
  };

  it("off (default) keeps the colon", () => {
    const r = renameForBooksAndAudio("Steinfeld - Der Drachenjunge [MP3-128kbps]", item);
    expect(r.rewrittenTitle).toContain("Der kleine Drache: Hin und zurück");
  });

  it("on strips the colon from author and title but not from the suffix", () => {
    const r = renameForBooksAndAudio(
      "Steinfeld - Der Drachenjunge [MP3-128kbps]",
      item,
      undefined,
      { stripSpecialChars: true },
    );
    expect(r.rewrittenTitle).toContain("Der kleine Drache Hin und zurück");
    expect(r.rewrittenTitle).toContain("[MP3-128kbps]");
  });
});
