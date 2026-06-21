import { describe, expect, it } from "vitest";
import {
  removeAccent,
  removeAccentButKeepDiacritics,
} from "@/domain/normalization/accents.js";
import {
  getCleanTitle,
  removeExtraWhitespaces,
} from "@/domain/normalization/clean.js";
import { normalizeForComparison } from "@/domain/normalization/comparison.js";
import {
  getLidarrTitleForExternalId,
  getReadarrTitleForExternalId,
  stripLeadingArticle,
} from "@/domain/normalization/index.js";
import {
  aggregatePlugins,
  applyCharMap,
  hasMappedChar,
} from "@/domain/plugins/aggregate.js";
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
    expect(removeAccentButKeepDiacritics("café Bär", germanPack)).toBe(
      "cafe Bär",
    );
  });
});

describe("getCleanTitle (German pack)", () => {
  it.each([
    ["Realm.of.Ravens", "Realm of Ravens"],
    ["Sigrid: Beyond the Realm's End", "Sigrid  Beyond the Realms End"],
    ["Some.Show.S01E01.GERMAN", "Some Show S01E01 GERMAN"],
  ])("%j -> %j", (input, expected) => {
    expect(getCleanTitle(input, germanPack)).toBe(
      removeExtraWhitespaces(expected),
    );
  });

  it("keeps a space when words are separated by tab/newline/CR", () => {
    // Whitespace must collapse to a single space, not be deleted outright
    // (which would glue the words: "a\tb" -> "ab").
    expect(getCleanTitle("a\tb", germanPack)).toBe("a b");
    expect(getCleanTitle("a\nb", germanPack)).toBe("a b");
    expect(getCleanTitle("a\r\nb", germanPack)).toBe("a b");
    expect(getCleanTitle("Some\tShow\nTitle", germanPack)).toBe(
      "Some Show Title",
    );
  });
});

describe("normalizeForComparison (German pack)", () => {
  it("strips spaces, special chars, lowercases, folds umlauts", () => {
    expect(normalizeForComparison("Bär: müde Strasse", germanPack)).toBe(
      "barmudestrasse",
    );
    expect(normalizeForComparison("Realm.of.Ravens", germanPack)).toBe(
      "realmofravens",
    );
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

describe("getLidarrTitleForExternalId", () => {
  it("strips article and accents, keeps umlauts", () => {
    expect(getLidarrTitleForExternalId("The Bär", germanPack)).toBe("Bär");
    expect(getLidarrTitleForExternalId("Die café", germanPack)).toBe("cafe");
  });
});

describe("getReadarrTitleForExternalId", () => {
  it("strips 'the', replaces separators", () => {
    expect(getReadarrTitleForExternalId("The Foo:Bar-Baz", germanPack)).toBe(
      "Foo Bar Baz",
    );
  });

  it("honors the language pack's article list (German), not just English 'the'", () => {
    // Routed through stripLeadingArticle so German articles are stripped too,
    // consistent with getLidarrTitleForExternalId.
    expect(getReadarrTitleForExternalId("Der König", germanPack)).toBe("König");
    expect(getReadarrTitleForExternalId("Die Hütte", germanPack)).toBe("Hütte");
  });
});
