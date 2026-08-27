import { describe, expect, it } from "vitest";
import { renameForMoviesAndTv } from "@/domain/matching/rename.js";

const sonarr = {
  expectedTitle: "Realm of Ravens",
  titleMatchVariations: [
    "Realm of Ravens",
    "Realm of Ravens - Lied der Schwarzen Raben",
  ],
};

describe("renameForMoviesAndTv", () => {
  it("rewrites German alias back to English title with original separator", () => {
    const result = renameForMoviesAndTv(
      "Realm.of.Ravens.Lied.der.Schwarzen.Raben.S01E01.GERMAN",
      sonarr,
    );
    expect(result.rewrittenTitle).not.toBeNull();
    expect(result.rewrittenTitle).toMatch(/^Realm\.of\.Ravens\./);
    expect(result.rewrittenTitle).toContain("S01E01");
  });

  it("returns null when expectedTitle equals variation (no rewrite needed)", () => {
    const result = renameForMoviesAndTv("Realm.of.Ravens.S01E01", {
      expectedTitle: "Realm of Ravens",
      titleMatchVariations: ["Realm of Ravens"],
    });
    expect(result.rewrittenTitle).toBeNull();
  });

  it("ambiguous-prefix: skips when expected starts with variation but no SxxExx pattern", () => {
    const item = {
      expectedTitle: "Sigrid: Beyond the Realm's End",
      titleMatchVariations: ["Sigrid", "Sigrid: Beyond the Realm's End"],
    };
    // ambiguous prefix without SxxExx → don't rewrite via "Sigrid"
    const result = renameForMoviesAndTv("Sigrid.German.WEB", item);
    // expectedTitle starts with "Sigrid" → skip per ambiguous rule
    expect(
      result.reason === "ambiguous-prefix" || result.rewrittenTitle === null,
    ).toBe(true);
  });

  it("ambiguous-prefix: rewrites when SxxExx follows", () => {
    const item = {
      expectedTitle: "Sigrid: Beyond the Realm's End",
      titleMatchVariations: ["Sigrid", "Sigrid: Beyond the Realm's End"],
    };
    const result = renameForMoviesAndTv("Sigrid.S01E01.GERMAN", item);
    expect(result.rewrittenTitle).not.toBeNull();
  });

  it("returns no-match when nothing matches", () => {
    const result = renameForMoviesAndTv("Some Other Show.S01E01", sonarr);
    expect(result.rewrittenTitle).toBeNull();
    expect(result.reason).toBe("no-match");
  });

  it("ignores variations that normalize to empty (regression: colon-only variation)", () => {
    // A variation like " -" (colon→" -" rewrite of ":") normalizes to "".
    // Without a guard, startsWith("") is vacuously true and the rewrite
    // produces "Galaxy.Wars:.The.Lost.Squad.alaxy.Wars.The.Lost.Squad.S01E02..."
    // because targetCount=0 still slices off the first char.
    const item = {
      expectedTitle: "Galaxy Wars: The Lost Squad",
      titleMatchVariations: [" -", "Galaxy Wars The Lost Squad"],
    };
    const result = renameForMoviesAndTv(
      "Galaxy.Wars.The.Lost.Squad.S01E02.GERMAN.DL.HDR.2160p.WEB.H265-VoDTv",
      item,
    );
    expect(result.rewrittenTitle).toBe(
      "Galaxy.Wars:.The.Lost.Squad.S01E02.GERMAN.DL.HDR.2160p.WEB.H265-VoDTv",
    );
  });

  it("returns no-match when only an empty-normalizing variation is present", () => {
    const result = renameForMoviesAndTv(
      "Galaxy.Wars.The.Lost.Squad.S01E02.GERMAN",
      {
        expectedTitle: "Galaxy Wars: The Lost Squad",
        titleMatchVariations: [" -"],
      },
    );
    expect(result.rewrittenTitle).toBeNull();
    expect(result.reason).toBe("no-match");
  });

  it("preserves SxxExx when the original carries an accent that no active plugin covers", () => {
    // German plugin is the default and lists only umlauts. An "é" in the
    // original still normalizes to "e" via NFD, so the walk must credit
    // it as 1 normalized char - otherwise the suffix slice eats the "S"
    // and we'd return "Coffee.House.01E01.GERMAN".
    const result = renameForMoviesAndTv("Café.S01E01.GERMAN", {
      expectedTitle: "Coffee House",
      titleMatchVariations: ["Cafe"],
    });
    expect(result.rewrittenTitle).toBe("Coffee.House.S01E01.GERMAN");
  });

  it("rewrites movies when a 4-digit year follows the prefix-match (ambiguous-prefix rule extended for movies)", () => {
    // "Galaxy Wars" is a prefix of expectedTitle "Galaxy Wars: Episode IV";
    // movies have no SxxExx so the rule used to block this rewrite. A
    // year directly after the prefix is now a sufficient release marker.
    const item = {
      expectedTitle: "Galaxy Wars: Episode IV",
      titleMatchVariations: ["Galaxy Wars", "Galaxy Wars: Episode IV"],
    };
    const result = renameForMoviesAndTv(
      "Galaxy.Wars.1977.German.BluRay.x264-GROUP",
      item,
    );
    expect(result.rewrittenTitle).toBe(
      "Galaxy.Wars:.Episode.IV.1977.German.BluRay.x264-GROUP",
    );
  });

  it("still blocks prefix-only rewrites when neither SxxExx nor year follows", () => {
    const item = {
      expectedTitle: "Galaxy Wars: Episode IV",
      titleMatchVariations: ["Galaxy Wars", "Galaxy Wars: Episode IV"],
    };
    const result = renameForMoviesAndTv("Galaxy.Wars.German.WEB-GROUP", item);
    expect(result.rewrittenTitle).toBeNull();
    expect(result.reason).toBe("ambiguous-prefix");
  });

  it("rejects token-continuation matches: 'Mike Renko 2' must not match 'Mike.Renko.2016'", () => {
    // A numeric-suffix alias like "Mike Renko 2" is a token of its own.
    // Without a token-boundary check, normalized "mikerenko2" is a string
    // prefix of "mikerenko2016germandl..." and the rewrite eats the leading
    // "2" of the year, producing "Die.Renko.Jagd.016.German.DL...".
    const item = {
      expectedTitle: "Die Renko Jagd",
      titleMatchVariations: ["Die Renko Jagd", "Mike Renko 2"],
    };
    const result = renameForMoviesAndTv(
      "Mike.Renko.2016.German.DL.2160p.HDR.UHD.BDRip.AV1",
      item,
    );
    expect(result.rewrittenTitle).toBeNull();
  });

  it("rejects year mismatch outside the +/-1 tolerance: Apex movie (2025) vs Apex Racing recording from 2030", () => {
    // The release is an Apex Racing recording, not the 2025 Apex movie. With
    // variation "Apex Racing" the prefix matches and the boundary is clean
    // ('-'), so only the year disambiguates. The +/-1 tolerance keeps
    // legitimate production-vs-release-year skew working, but a 5-year gap
    // is well outside it and must be rejected.
    const item = {
      expectedTitle: "Apex - Der Film",
      year: 2025,
      titleMatchVariations: ["Apex - Der Film", "Apex Racing", "Apex"],
    };
    const result = renameForMoviesAndTv(
      "Apex.Racing-Round.GP-Finishline-3.Mayis.2030-720p.TOD.WEB-DL.AAC.H.264-TURG",
      item,
    );
    expect(result.rewrittenTitle).toBeNull();
    expect(result.reason).toBe("year-mismatch");
  });

  it("allows year match: same item with a 2025 release rewrites cleanly", () => {
    const item = {
      expectedTitle: "Apex - Der Film",
      year: 2025,
      titleMatchVariations: ["Apex - Der Film", "Apex Racing", "Apex"],
    };
    const result = renameForMoviesAndTv(
      "Apex.Racing.2025.German.WEB-DL.AAC.H.264-GROUP",
      item,
    );
    expect(result.rewrittenTitle).toBe(
      "Apex.-.Der.Film.2025.German.WEB-DL.AAC.H.264-GROUP",
    );
  });

  it("accepts a release year within +/-1 tolerance (production vs release year)", () => {
    // Common skew: Radarr stores the release year (e.g. 2024) but the
    // scene-release names the production year (2023) or vice versa. A
    // strict equality check would refuse those; the +/-1 tolerance keeps
    // them rewriting normally.
    const item = {
      expectedTitle: "Apex - Der Film",
      year: 2025,
      titleMatchVariations: ["Apex - Der Film", "Apex Racing"],
    };
    const within = renameForMoviesAndTv(
      "Apex.Racing.2024.German.WEB-DL.AAC.H.264-GROUP",
      item,
    );
    expect(within.rewrittenTitle).not.toBeNull();
    const above = renameForMoviesAndTv(
      "Apex.Racing.2026.German.WEB-DL.AAC.H.264-GROUP",
      item,
    );
    expect(above.rewrittenTitle).not.toBeNull();
  });

  it("rejects a release year that exceeds the +/-1 tolerance", () => {
    const item = {
      expectedTitle: "Apex - Der Film",
      year: 2025,
      titleMatchVariations: ["Apex - Der Film", "Apex Racing"],
    };
    const result = renameForMoviesAndTv(
      "Apex.Racing.2027.German.WEB-DL.AAC.H.264-GROUP",
      item,
    );
    expect(result.rewrittenTitle).toBeNull();
    expect(result.reason).toBe("year-mismatch");
  });

  it("preserves trailing release-format tag (3D) when an alias variation includes it", () => {
    // Title providers occasionally list a "<Title> 3D" alias for the 3D
    // release. The variation matches up through the "3D" of the original,
    // but "3D" belongs to the release name, not the title, and must
    // survive the rewrite.
    const item = {
      expectedTitle: "Galaxy Wars: Reckoning",
      year: 2010,
      titleMatchVariations: [
        "Galaxy Wars: Reckoning",
        "Galaxy Wars Reckoning 3D",
      ],
    };
    const result = renameForMoviesAndTv(
      "Galaxy.Wars.Reckoning.3D.2010.German.DL.1080p.BluRay.x264-GROUP",
      item,
    );
    expect(result.rewrittenTitle).toBe(
      "Galaxy.Wars:.Reckoning.3D.2010.German.DL.1080p.BluRay.x264-GROUP",
    );
  });

  it("keeps a release-format tag that is genuinely part of the title", () => {
    // Here "3D" is part of the expectedTitle, so the rewrite must NOT
    // strip it off the suffix.
    const item = {
      expectedTitle: "Galaxy Wars 3D Showdown",
      year: 2003,
      titleMatchVariations: ["Galaxy Wars 3D Showdown"],
    };
    const result = renameForMoviesAndTv(
      "Galaxy.Wars.3D.Showdown.2003.German.DL.1080p.BluRay.x264-GROUP",
      item,
    );
    // Variation equals expectedTitle so no rewrite is needed.
    expect(result.rewrittenTitle).toBeNull();
  });

  it("allows release without a year token even when item has a year", () => {
    // Some releases don't carry a year (older scene names). Don't reject
    // those: only reject when both sides have a 4-digit year and they
    // disagree.
    const item = {
      expectedTitle: "Apex - Der Film",
      year: 2025,
      titleMatchVariations: ["Apex - Der Film", "Apex Racing"],
    };
    const result = renameForMoviesAndTv(
      "Apex.Racing.German.WEB-DL.S01E01.AAC.H.264-GROUP",
      item,
    );
    expect(result.rewrittenTitle).not.toBeNull();
  });

  it("skips trailing closing parentheses when variation without parentheses matches release title with parentheses", () => {
    // Regression test: when searchItem has expectedTitle "Chronicles of Time (2005)"
    // and variation "Chronicles of Time 2005" matches "Chronicles of Time (2005) - S08E08...",
    // targetCount reached on '5' used to leave trailing ')' in the suffix,
    // producing "Chronicles of Time (2005) ) - S08E08...".
    const item = {
      expectedTitle: "Chronicles of Time (2005)",
      year: 2005,
      titleMatchVariations: [
        "Chronicles of Time (2005)",
        "Chronicles of Time 2005",
      ],
    };
    const result = renameForMoviesAndTv(
      "Chronicles of Time (2005) - S08E08 - Mystery on the Stellar Express - Bluray-720p",
      item,
    );
    expect(result.rewrittenTitle).toBe(
      "Chronicles of Time (2005) - S08E08 - Mystery on the Stellar Express - Bluray-720p",
    );
  });

  it("skips the trailing closing paren in a dot-separated scene name", () => {
    // Same leak as above in the shape release names actually arrive in:
    // dot-separated, no spaces. Used to produce "...(2005).).S08E08...".
    const item = {
      expectedTitle: "Chronicles of Time (2005)",
      year: 2005,
      titleMatchVariations: [
        "Chronicles of Time (2005)",
        "Chronicles of Time 2005",
      ],
    };
    const result = renameForMoviesAndTv(
      "Chronicles.of.Time.(2005).S08E08.Mystery.Bluray-720p",
      item,
    );
    expect(result.rewrittenTitle).toBe(
      "Chronicles.of.Time.(2005).S08E08.Mystery.Bluray-720p",
    );
  });

  it("keeps renaming when an opening delimiter follows the match without a separator", () => {
    // Guard for the trailing-punctuation skip: it must consume *closing*
    // delimiters only. Swallowing the "(" / "[" here would land the
    // token-boundary check on '2' and discard a valid match, leaving the
    // release un-renamed entirely.
    const item = {
      expectedTitle: "Zeitchroniken",
      year: 2005,
      titleMatchVariations: ["Chronicles of Time"],
    };
    expect(
      renameForMoviesAndTv("Chronicles of Time(2005) S08E08 Bluray-720p", item)
        .rewrittenTitle,
    ).toBe("Zeitchroniken (2005) S08E08 Bluray-720p");
    expect(
      renameForMoviesAndTv("Chronicles of Time[2005] S08E08 Bluray-720p", item)
        .rewrittenTitle,
    ).toBe("Zeitchroniken [2005] S08E08 Bluray-720p");
  });
});
