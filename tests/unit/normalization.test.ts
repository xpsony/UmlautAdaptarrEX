import { describe, expect, it } from "vitest";
import { removeAccent, removeAccentButKeepDiacritics } from "@/domain/normalization/accents.js";
import { getCleanTitle, removeExtraWhitespaces } from "@/domain/normalization/clean.js";
import { normalizeForComparison } from "@/domain/normalization/comparison.js";
import {
  getReadarrTitleForExternalId,
  lidarrAlbumSearchKeys,
  lidarrQueryTitle,
  lidarrSearchKey,
  stripLeadingArticle,
} from "@/domain/normalization/index.js";
import { aggregatePlugins, applyCharMap, hasMappedChar } from "@/domain/plugins/aggregate.js";
import { germanUmlauts } from "@/domain/plugins/german-umlauts/index.js";

const germanPack = aggregatePlugins([germanUmlauts]);
const [latinMap, dotsMap] = germanUmlauts.variationMaps;
const stripAllMap = germanUmlauts.audioOnlyMaps![0]!;

describe("hasMappedChar (German)", () => {
  it.each([
    ["Bär", true],
    ["müde", true],
    ["öffentlich", true],
    ["Straße", true],
    ["plain", false],
    ["", false],
  ])("hasMappedChar(%j) = %s", (input, expected) => {
    expect(hasMappedChar(input, germanPack.comparisonMap)).toBe(expected);
  });
});

describe("German plugin: Latin-equivalent map", () => {
  it.each([
    ["Bär", "Baer"],
    ["müde", "muede"],
    ["öffentlich", "oeffentlich"],
    ["ÄÖÜß", "AeOeUess"],
    ["abc", "abc"],
  ])("%j -> %j", (input, expected) => {
    expect(applyCharMap(input, latinMap!)).toBe(expected);
  });
});

describe("German plugin: dots-removed map (= comparison map)", () => {
  it("ä→a, ö→o, ü→u, Ä→A, ß→ss", () => {
    expect(applyCharMap("Bär müde Straße", dotsMap!)).toBe("Bar mude Strasse");
  });
});

describe("German plugin: audio/book strip-all map", () => {
  it("removes umlauts entirely", () => {
    expect(applyCharMap("Bär müde", stripAllMap)).toBe("Br mde");
  });
});

describe("removeAccent", () => {
  it("removes diacritics including diaeresis", () => {
    expect(removeAccent("café")).toBe("cafe");
    expect(removeAccent("Bär")).toBe("Bar");
  });
});

describe("removeAccentButKeepDiacritics (German pack)", () => {
  it("keeps ä/ö/ü, removes other accents", () => {
    expect(removeAccentButKeepDiacritics("café Bär", germanPack)).toBe("cafe Bär");
  });
});

describe("getCleanTitle (German pack)", () => {
  it.each([
    ["Realm.of.Ravens", "Realm of Ravens"],
    ["Sigrid: Beyond the Realm's End", "Sigrid  Beyond the Realms End"],
    ["Some.Show.S01E01.GERMAN", "Some Show S01E01 GERMAN"],
  ])("%j -> %j", (input, expected) => {
    expect(getCleanTitle(input, germanPack)).toBe(removeExtraWhitespaces(expected));
  });

  it("keeps a space when words are separated by tab/newline/CR", () => {
    // Whitespace must collapse to a single space, not be deleted outright
    // (which would glue the words: "a\tb" -> "ab").
    expect(getCleanTitle("a\tb", germanPack)).toBe("a b");
    expect(getCleanTitle("a\nb", germanPack)).toBe("a b");
    expect(getCleanTitle("a\r\nb", germanPack)).toBe("a b");
    expect(getCleanTitle("Some\tShow\nTitle", germanPack)).toBe("Some Show Title");
  });
});

describe("normalizeForComparison (German pack)", () => {
  it("strips spaces, special chars, lowercases, folds umlauts", () => {
    expect(normalizeForComparison("Bär: müde Strasse", germanPack)).toBe("barmudestrasse");
    expect(normalizeForComparison("Realm.of.Ravens", germanPack)).toBe("realmofravens");
  });
});

describe("stripLeadingArticle (German pack)", () => {
  it.each([
    ["Der König", "König"],
    ["Die Hütte", "Hütte"],
    ["Das Schiff", "Schiff"],
    ["The Path", "Path"],
    ["An Echo", "Echo"],
    ["A Star", "Star"],
  ])("%j -> %j", (input, expected) => {
    expect(stripLeadingArticle(input, germanPack)).toBe(expected);
  });
});

describe("lidarrQueryTitle (mirrors Lidarr's GetQueryTitle)", () => {
  it.each([
    ["Die Bären", "Die Baren"],
    ["The Lanterns", "Lanterns"],
    ["AB/CD", "AB CD"],
    ["Mondfähre (Live)", "Mondfahre Live"],
    ["Sören\u2019s Kapelle", "Soren's Kapelle"],
    ["Various Artists", "VA"],
    ["Straße", "Straße"],
    ["!!!", "!!!"],
  ])("%j -> %j", (input, expected) => {
    expect(lidarrQueryTitle(input)).toBe(expected);
  });
});

describe("lidarrSearchKey", () => {
  it("folds case, accents, punctuation and whitespace", () => {
    expect(lidarrSearchKey("  Die  Bären: Mondfähre ")).toBe("die baren mondfahre");
    expect(lidarrSearchKey("AB/CD")).toBe("ab cd");
  });
});

describe("lidarrAlbumSearchKeys", () => {
  // `q` as Lidarr sends it: the cleaned artist and album joined by a space
  // (default), or the raw names when the indexer reports searchEngine="raw".
  it.each([
    ["Die Bären", "Mondfähre", "Die Baren Mondfahre"],
    ["Die Bären", "Mondfähre", "Die Bären Mondfähre"],
    ["AB/CD", "Grauzone", "AB CD Grauzone"],
    ["The Lanterns", "The Quiet Harbour", "Lanterns Quiet Harbour"],
    ["The Lanterns", "The Quiet Harbour", "The Lanterns The Quiet Harbour"],
  ])("finds %j - %j under the query %j", (artist, album, q) => {
    expect(lidarrAlbumSearchKeys({ artist, album })).toContain(lidarrSearchKey(q));
  });

  it("appends the disambiguation the way Lidarr does", () => {
    const keys = lidarrAlbumSearchKeys({
      artist: "Die Bären",
      album: "Mondfähre",
      disambiguation: "Deluxe",
    });
    expect(keys).toContain(lidarrSearchKey("Die Baren Mondfahre Deluxe"));
    expect(keys).not.toContain(lidarrSearchKey("Die Baren Mondfahre"));
  });

  it("appends the year to a self-titled album, 0 when Lidarr knows no release date", () => {
    expect(lidarrAlbumSearchKeys({ artist: "Nordlicht", album: "Nordlicht", year: 2004 })).toEqual([
      "nordlicht nordlicht 2004",
    ]);
    expect(lidarrAlbumSearchKeys({ artist: "Nordlicht", album: "Nordlicht" })).toEqual([
      "nordlicht nordlicht 0",
    ]);
  });

  it("returns one key when the raw and the cleaned query coincide", () => {
    expect(lidarrAlbumSearchKeys({ artist: "Nordlicht", album: "Polarnacht" })).toEqual([
      "nordlicht polarnacht",
    ]);
  });
});

describe("getReadarrTitleForExternalId", () => {
  it("strips 'the', replaces separators", () => {
    expect(getReadarrTitleForExternalId("The Foo:Bar-Baz", germanPack)).toBe("Foo Bar Baz");
  });

  it("honors the language pack's article list (German), not just English 'the'", () => {
    // Routed through stripLeadingArticle so German articles are stripped too,
    // consistent with the other article-aware helpers.
    expect(getReadarrTitleForExternalId("Der König", germanPack)).toBe("König");
    expect(getReadarrTitleForExternalId("Die Hütte", germanPack)).toBe("Hütte");
  });
});
