import { describe, expect, it } from "vitest";
import { rewriteIndexerXml } from "@/domain/xml/rewrite.js";

const XML_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss>
  <channel>
    <title>TestIndexer</title>
    <item>
      <title>Realm.of.Ravens.Lied.der.Schwarzen.Raben.S01E01.GERMAN</title>
      <category>5000</category>
    </item>
    <item>
      <title>Some.Unrelated.Show.S01E01</title>
      <category>5000</category>
    </item>
  </channel>
</rss>`;

describe("rewriteIndexerXml", () => {
  it("rewrites German alias title back to expectedTitle", () => {
    const got = rewriteIndexerXml(XML_FIXTURE, {
      searchItem: {
        expectedTitle: "Realm of Ravens",
        expectedAuthor: null,
        titleMatchVariations: [
          "Realm of Ravens",
          "Realm of Ravens - Lied der Schwarzen Raben",
        ],
        authorMatchVariations: [],
        mediaType: "tv",
      },
    });
    expect(got).toContain("Realm.of.Ravens.S01E01.GERMAN");
    expect(got).toContain("Some.Unrelated.Show.S01E01");
  });

  it("calls onRename for each rewrite", () => {
    const events: Array<{ originalTitle: string; rewrittenTitle: string }> = [];
    rewriteIndexerXml(XML_FIXTURE, {
      searchItem: {
        expectedTitle: "Realm of Ravens",
        expectedAuthor: null,
        titleMatchVariations: ["Realm of Ravens - Lied der Schwarzen Raben"],
        authorMatchVariations: [],
        mediaType: "tv",
      },
      onRename: (e) => events.push(e),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.originalTitle).toContain("Lied.der.Schwarzen.Raben");
  });

  it("fires onRename when only a Newznab subcategory id is present", () => {
    // Regression: indexers commonly tag items with a sub-id like 5040 (TV/HD)
    // or 5070 (TV/Anime). Previously the classifier only matched the parent
    // 5000 / "TV*", so these items were skipped before reaching onRename and
    // never showed up in the RenameHistory page (only movies tagged with
    // "Movies/HD" or "2000" got through).
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss>
  <channel>
    <item>
      <title>Realm.of.Ravens.Lied.der.Schwarzen.Raben.S01E01.GERMAN</title>
      <category>5040</category>
    </item>
  </channel>
</rss>`;
    const events: Array<{ originalTitle: string; mediaType: string }> = [];
    rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Realm of Ravens",
        expectedAuthor: null,
        titleMatchVariations: ["Realm of Ravens - Lied der Schwarzen Raben"],
        authorMatchVariations: [],
        mediaType: "tv",
      },
      onRename: (e) => events.push(e),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.mediaType).toBe("tv");
  });

  it("scans every <category> entry, not just the first", () => {
    // Some indexers list the sub-cat first and the parent second; an exotic
    // sub-cat shouldn't black-hole the item when a recognised parent is
    // right next to it.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss>
  <channel>
    <item>
      <title>Realm.of.Ravens.Lied.der.Schwarzen.Raben.S01E01.GERMAN</title>
      <category>9999</category>
      <category>5000</category>
    </item>
  </channel>
</rss>`;
    const events: Array<{ originalTitle: string }> = [];
    rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Realm of Ravens",
        expectedAuthor: null,
        titleMatchVariations: ["Realm of Ravens - Lied der Schwarzen Raben"],
        authorMatchVariations: [],
        mediaType: "tv",
      },
      onRename: (e) => events.push(e),
    });
    expect(events).toHaveLength(1);
  });

  it("skips items without category", () => {
    const xml = `<rss><channel><item><title>foo.bar</title></item></channel></rss>`;
    const got = rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "foo",
        expectedAuthor: null,
        titleMatchVariations: ["foo bar"],
        authorMatchVariations: [],
        mediaType: "tv",
      },
    });
    expect(got).toContain("foo.bar");
  });

  // Regression: Newznab/Torznab feeds use `<guid isPermaLink="true">` and the
  // builder used to emit it as bare `isPermaLink` (invalid XML), causing
  // Sonarr/Radarr to drop the entire feed and report empty search results.
  it('preserves boolean-valued attributes (isPermaLink="true") on roundtrip', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
  <channel>
    <item>
      <title>Some.Show.S01E01</title>
      <guid isPermaLink="true">http://example.com/details/abc</guid>
      <category>5040</category>
      <newznab:attr name="tvdbid" value="12345"/>
      <newznab:attr name="season" value="1"/>
    </item>
  </channel>
</rss>`;
    const got = rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Some Show",
        expectedAuthor: null,
        titleMatchVariations: ["Some Show"],
        authorMatchVariations: [],
        mediaType: "tv",
      },
    });
    expect(got).toContain('isPermaLink="true"');
    expect(got).not.toMatch(/<guid isPermaLink>/);
    // Newznab attrs must roundtrip - Sonarr identifies tvdbid/season/episode
    // through these.
    expect(got).toContain('name="tvdbid"');
    expect(got).toContain('value="12345"');
  });

  // Real indexer responses commonly wrap titles/descriptions in CDATA. The
  // roundtrip must preserve the CDATA so Sonarr sees the title intact.
  it("preserves CDATA-wrapped titles and rewrites them inside CDATA", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Realm.of.Ravens.Lied.der.Schwarzen.Raben.S01E01.GERMAN]]></title>
      <description><![CDATA[<p>raw html ok</p>]]></description>
      <category>5000</category>
    </item>
  </channel>
</rss>`;
    const got = rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Realm of Ravens",
        expectedAuthor: null,
        titleMatchVariations: ["Realm of Ravens - Lied der Schwarzen Raben"],
        authorMatchVariations: [],
        mediaType: "tv",
      },
    });
    expect(got).toContain("<![CDATA[Realm.of.Ravens.S01E01.GERMAN]]>");
    expect(got).toContain("<![CDATA[<p>raw html ok</p>]]>");
  });

  // Untouched items also roundtrip cleanly - no whitespace garbage and
  // ampersands stay properly escaped.
  it("keeps non-matching items intact and does not introduce whitespace garbage", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss>
  <channel>
    <item>
      <title>Some.Unrelated.Show &amp; Co.S01E01</title>
      <category>5000</category>
    </item>
  </channel>
</rss>`;
    const got = rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Realm of Ravens",
        expectedAuthor: null,
        titleMatchVariations: ["Realm of Ravens"],
        authorMatchVariations: [],
        mediaType: "tv",
      },
    });
    expect(got).toContain("Some.Unrelated.Show &amp; Co.S01E01");
    expect(got).not.toMatch(/\n\s{2,}\n/);
  });

  it("respects enableYearMatching=false: rewrites despite a year mismatch", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss>
  <channel>
    <item>
      <title>Apex.Racing-Round.GP-Finishline-3.Mayis.2030-720p.WEB-DL-TURG</title>
      <category>2000</category>
    </item>
  </channel>
</rss>`;
    // With year matching enabled (default) the 2030 release would be
    // rejected against a 2025 item; setting yearMatchingTolerance=null on
    // the search item disables the year check entirely (the per-instance
    // opt-out path) and restores 1.x behaviour where only the title
    // disambiguates.
    const got = rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Apex - Der Film",
        expectedAuthor: null,
        titleMatchVariations: ["Apex - Der Film", "Apex Racing"],
        authorMatchVariations: [],
        mediaType: "movie",
        year: 2025,
        yearMatchingTolerance: null,
      },
    });
    expect(got).toContain("Apex.-.Der.Film");
  });

  it("default (enableYearMatching omitted): rejects rewrite when years disagree past tolerance", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss>
  <channel>
    <item>
      <title>Apex.Racing-Round.GP-Finishline-3.Mayis.2030-720p.WEB-DL-TURG</title>
      <category>2000</category>
    </item>
  </channel>
</rss>`;
    const got = rewriteIndexerXml(xml, {
      searchItem: {
        expectedTitle: "Apex - Der Film",
        expectedAuthor: null,
        titleMatchVariations: ["Apex - Der Film", "Apex Racing"],
        authorMatchVariations: [],
        mediaType: "movie",
        year: 2025,
      },
    });
    expect(got).not.toContain("Apex.-.Der.Film");
    expect(got).toContain("Apex.Racing-Round.GP-Finishline-3.Mayis.2030");
  });
});
