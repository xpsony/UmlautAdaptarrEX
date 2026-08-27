import { describe, expect, it } from "vitest";
import { rewriteIndexerXml } from "@/domain/xml/rewrite";
import { externalIdAttributes, resolveAttrKey } from "@/domain/xml/newznab-attrs";

// Attribute names are dictated by what Sonarr/Radarr actually parse:
//   Sonarr NewznabRssParser -> "tvdbid", "rageid", "imdb"
//   Radarr NewznabRssParser -> "tmdbid", "imdb"
// Both read "imdb" with int.TryParse, so a "tt"-prefixed value would be lost.

describe("externalIdAttributes", () => {
  it("emits tvdbid for tv", () => {
    expect(externalIdAttributes({ mediaType: "tv", externalId: "900001" })).toEqual([
      { name: "tvdbid", value: "900001" },
    ]);
  });

  it("emits tmdbid plus a numeric imdb for movies", () => {
    expect(
      externalIdAttributes({
        mediaType: "movie",
        externalId: "800002",
        imdbId: "tt7654321",
      }),
    ).toEqual([
      { name: "tmdbid", value: "800002" },
      { name: "imdb", value: "7654321" },
    ]);
  });

  it("accepts an already-numeric imdb id", () => {
    const attrs = externalIdAttributes({
      mediaType: "movie",
      externalId: "800002",
      imdbId: "7654321",
    });
    expect(attrs).toContainEqual({ name: "imdb", value: "7654321" });
  });

  it("skips a non-numeric imdb id instead of emitting garbage", () => {
    expect(
      externalIdAttributes({
        mediaType: "movie",
        externalId: "800002",
        imdbId: "not-an-id",
      }),
    ).toEqual([{ name: "tmdbid", value: "800002" }]);
  });

  it("skips non-numeric externalIds (Lidarr/Readarr use titles)", () => {
    expect(externalIdAttributes({ mediaType: "audio", externalId: "Some Artist" })).toEqual([]);
    expect(externalIdAttributes({ mediaType: "tv", externalId: "not-a-number" })).toEqual([]);
  });
});

describe("resolveAttrKey", () => {
  it("mirrors torznab when the items already use it", () => {
    expect(resolveAttrKey({}, { "torznab:attr": {} })).toEqual({
      key: "torznab:attr",
      needsNamespaceDecl: false,
    });
  });

  it("mirrors newznab when the items already use it", () => {
    expect(resolveAttrKey({}, { "newznab:attr": {} })).toEqual({
      key: "newznab:attr",
      needsNamespaceDecl: false,
    });
  });

  it("falls back to the declared namespace when no item carries an attr", () => {
    expect(resolveAttrKey({ "@_xmlns:torznab": "x" }, {})).toEqual({
      key: "torznab:attr",
      needsNamespaceDecl: false,
    });
  });

  it("declares newznab itself when the feed has neither", () => {
    expect(resolveAttrKey({}, {})).toEqual({
      key: "newznab:attr",
      needsNamespaceDecl: true,
    });
  });
});

const TV_ITEM = {
  expectedTitle: "Realm of Ravens",
  expectedAuthor: null,
  titleMatchVariations: ["Lied der Schwarzen Raben"],
  authorMatchVariations: [],
  mediaType: "tv" as const,
  externalId: "900001",
  year: null,
};

function tvFeed(extraItemXml = "", rssAttrs = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"${rssAttrs}>
  <channel>
    <item>
      <title>Lied.der.Schwarzen.Raben.S01E01.GERMAN</title>
      <category>5000</category>
      ${extraItemXml}
    </item>
  </channel>
</rss>`;
}

describe("rewriteIndexerXml: attachExternalIds", () => {
  it("off (default) leaves the item without id attributes", () => {
    const got = rewriteIndexerXml(tvFeed(), { searchItem: TV_ITEM });
    expect(got).toContain("Realm.of.Ravens.S01E01");
    expect(got).not.toContain("tvdbid");
  });

  it("adds tvdbid and declares the newznab namespace on a bare feed", () => {
    const got = rewriteIndexerXml(tvFeed(), {
      searchItem: TV_ITEM,
      attachExternalIds: true,
    });
    expect(got).toContain('name="tvdbid"');
    expect(got).toContain('value="900001"');
    expect(got).toContain('xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"');
  });

  it("uses torznab:attr when the feed already speaks torznab", () => {
    const got = rewriteIndexerXml(
      tvFeed('<torznab:attr name="seeders" value="12"/>', ' xmlns:torznab="x"'),
      { searchItem: TV_ITEM, attachExternalIds: true },
    );
    expect(got).toContain('<torznab:attr name="tvdbid" value="900001"');
    expect(got).not.toContain("newznab:attr");
    // The indexer's own attribute survives.
    expect(got).toContain('name="seeders"');
    // We must not add a second namespace declaration.
    expect(got).not.toContain("xmlns:newznab");
  });

  it("never overwrites an id the indexer already supplied", () => {
    const got = rewriteIndexerXml(
      tvFeed('<newznab:attr name="tvdbid" value="999999"/>', ' xmlns:newznab="x"'),
      { searchItem: TV_ITEM, attachExternalIds: true },
    );
    expect(got).toContain('value="999999"');
    expect(got).not.toContain('value="900001"');
  });

  it("adds ids even when the rename was refused", () => {
    // Year mismatch -> no rewrite, but the id is still correct and is exactly
    // what spares Sonarr the title parsing.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Lied.der.Schwarzen.Raben.2019.GERMAN</title>
      <category>5000</category>
    </item>
  </channel>
</rss>`;
    const got = rewriteIndexerXml(xml, {
      searchItem: { ...TV_ITEM, year: 2025, yearMatchingTolerance: 0 },
      attachExternalIds: true,
    });
    expect(got).toContain("Lied.der.Schwarzen.Raben.2019.GERMAN");
    expect(got).toContain('name="tvdbid"');
  });

  it("emits tmdbid + imdb for a movie item", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Ember.Stahlengel.2019.GERMAN.1080p</title>
      <category>2000</category>
    </item>
  </channel>
</rss>`;
    const got = rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Ember Steel Angel",
        expectedAuthor: null,
        titleMatchVariations: ["Ember Stahlengel"],
        authorMatchVariations: [],
        mediaType: "movie",
        externalId: "800003",
        imdbId: "tt7654322",
        year: 2019,
      },
      attachExternalIds: true,
    });
    expect(got).toContain('name="tmdbid" value="800003"');
    expect(got).toContain('name="imdb" value="7654322"');
  });
});
