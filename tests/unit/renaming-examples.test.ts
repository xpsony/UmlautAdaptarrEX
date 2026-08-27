import { describe, expect, it } from "vitest";
import { renameForMoviesAndTv } from "@/domain/matching/rename";
import { rewriteIndexerXml } from "@/domain/xml/rewrite";
import { RENAMING_EXAMPLES } from "@/app/(admin)/settings/_lib/settings-types";

// The Renaming tab shows a worked before/after example per toggle. Copy that
// claims something the code does not do is worse than no copy at all, so every
// example is replayed through the real domain functions here. If a matching
// rule changes, this test fails and the UI text has to be corrected with it.
//
// Each case mirrors the `item` line shown in the UI as an actual search item.

describe("Renaming tab examples match the real rename output", () => {
  it("renameStripSpecialChars", () => {
    const ex = RENAMING_EXAMPLES.renameStripSpecialChars;
    const item = {
      expectedTitle: "Ember: Steel Angel",
      titleMatchVariations: ["Ember Stahlengel"],
      year: null,
    };
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, {
        stripSpecialChars: false,
      }).rewrittenTitle,
    ).toBe(ex.off);
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, {
        stripSpecialChars: true,
      }).rewrittenTitle,
    ).toBe(ex.on);
  });

  it("renameYearGuard", () => {
    const ex = RENAMING_EXAMPLES.renameYearGuard;
    const item = {
      expectedTitle: "GP - Der Film",
      titleMatchVariations: ["Grand Prix"],
      year: 2025,
    };
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, { yearGuard: false }).rewrittenTitle,
    ).toBe(ex.off);
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, { yearGuard: true }).rewrittenTitle,
    ).toBe(ex.on);
  });

  it("renamePrefixGuard", () => {
    const ex = RENAMING_EXAMPLES.renamePrefixGuard;
    const item = {
      expectedTitle: "Silberlicht: Ende der Reise",
      titleMatchVariations: ["Silberlicht"],
      year: null,
    };
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, { prefixGuard: false }).rewrittenTitle,
    ).toBe(ex.off);
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, { prefixGuard: true }).rewrittenTitle,
    ).toBe(ex.on);
    // The caveat the UI note makes: with a season marker the guard lets it
    // through, so the example must not read as "never renames".
    expect(
      renameForMoviesAndTv("Silberlicht.S01E01.GERMAN.1080p.WEB.h264-GRP", item, undefined, {
        prefixGuard: true,
      }).rewrittenTitle,
    ).toBe("Silberlicht:.Ende.der.Reise.S01E01.GERMAN.1080p.WEB.h264-GRP");
  });

  it("renameReleaseTagGuard", () => {
    const ex = RENAMING_EXAMPLES.renameReleaseTagGuard;
    const item = {
      expectedTitle: "Nachtwache Wiederkehr",
      titleMatchVariations: ["Nachtwache Wiederkehr 3D"],
      year: null,
    };
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, {
        releaseTagGuard: false,
      }).rewrittenTitle,
    ).toBe(ex.off);
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, { releaseTagGuard: true }).rewrittenTitle,
    ).toBe(ex.on);
  });

  it("renameLegacySuffix", () => {
    const ex = RENAMING_EXAMPLES.renameLegacySuffix;
    const item = {
      expectedTitle: "Die Renko Jagd",
      titleMatchVariations: ["Renko Jagd 2"],
      year: null,
    };
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, { legacySuffix: false }).rewrittenTitle,
    ).toBe(ex.off);
    expect(
      renameForMoviesAndTv(ex.input, item, undefined, { legacySuffix: true }).rewrittenTitle,
    ).toBe(ex.on);
  });

  it("renameAttachExternalIds", () => {
    const ex = RENAMING_EXAMPLES.renameAttachExternalIds;
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>' +
      `<item><title>${ex.input}</title><category>2000</category></item>` +
      "</channel></rss>";
    const searchItem = {
      expectedTitle: "Ember: Steel Angel",
      expectedAuthor: null,
      titleMatchVariations: ["Ember Stahlengel"],
      authorMatchVariations: [],
      mediaType: "movie" as const,
      externalId: "800003",
      imdbId: "tt7654322",
      year: 2019,
    };
    const on = rewriteIndexerXml(xml, {
      searchItem,
      attachExternalIds: true,
      rename: { stripSpecialChars: true },
    });
    // The example shows an abbreviated `<item>`; assert the parts it claims.
    expect(on).toContain("<title>Ember.Steel.Angel.2019.GERMAN.1080p</title>");
    expect(on).toContain('name="tmdbid" value="800003"');
    expect(on).toContain('name="imdb" value="7654322"');

    const off = rewriteIndexerXml(xml, {
      searchItem,
      rename: { stripSpecialChars: true },
    });
    expect(off).not.toContain("tmdbid");
    expect(off).not.toContain('name="imdb"');

    // The example elides the (unchanged) title, but the attribute elements it
    // shows must be exactly the ones the rewrite emits.
    for (const attr of ['name="tmdbid" value="800003"', 'name="imdb" value="7654322"']) {
      expect(ex.on).toContain(attr);
      expect(on).toContain(attr);
      expect(ex.off).not.toContain(attr);
    }
  });

  it("covers every toggle", () => {
    // Guards against a new toggle being added without an example.
    expect(Object.keys(RENAMING_EXAMPLES)).toHaveLength(6);
    for (const [name, ex] of Object.entries(RENAMING_EXAMPLES)) {
      expect(ex.input, name).toBeTruthy();
      // A before/after that shows the same thing twice teaches nothing.
      expect(ex.off, name).not.toBe(ex.on);
    }
  });
});
