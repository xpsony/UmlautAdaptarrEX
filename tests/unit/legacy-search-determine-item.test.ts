import { describe, expect, it } from "vitest";
import { determineSearchItem } from "@/server/routes/legacy/search";
import { SearchItemIndex } from "@/server/search-index";
import { aggregatePlugins, BUILTIN_PLUGINS } from "@/domain/plugins";
import { rewriteIndexerXml } from "@/domain/xml/rewrite";

const PACK = aggregatePlugins(BUILTIN_PLUGINS.filter((p) => p.defaultEnabled));
const LISTENARR_UA = "Listenarr/1.4.0.0 (+https://github.com/Listenarrs/listenarr)";

function stateWithBook() {
  const index = new SearchItemIndex();
  index.indexItem(
    {
      id: "id-1",
      arrInstanceId: "inst-1",
      arrId: 7,
      externalId: "Sunken Bells Marla Ostrand",
      externalIdAliases: null,
      imdbId: null,
      title: "Sunken Bells",
      expectedTitle: "Sunken Bells",
      expectedAuthor: "Marla Ostrand",
      germanTitle: null,
      mediaType: "book",
      year: null,
      titleSearchVariations: [],
      titleMatchVariations: ["Sunken Bells"],
      authorMatchVariations: ["Marla Ostrand"],
    },
    PACK,
  );
  return {
    getByExternalId: (type: string, id: string) => index.getByExternalId(type as never, id),
    findByTitle: () => null,
  } as never;
}

describe("determineSearchItem, t=search without cat", () => {
  it("falls back to book for a Listenarr user agent", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook(), LISTENARR_UA);
    expect(item?.title).toBe("Sunken Bells");
  });

  it("stays null for any other user agent", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook(), "Readarr/1.0.0");
    expect(item).toBeNull();
  });

  it("stays null when there is no user agent at all", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook(), "");
    expect(item).toBeNull();
  });

  it("lets the category decide when one is present, whatever the user agent", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand", cat: "5040" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook(), LISTENARR_UA);
    expect(item).toBeNull();
  });
});

describe("Listenarr end to end", () => {
  it("rewrites a badly named release into author and title", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item>
<title>Sunken.Bells.Marla.Ostrand.GERMAN.2026.MP3-128kbps</title>
<category>3030</category>
<link>http://indexer.local/dl/1</link>
</item></channel></rss>`;

    const out = rewriteIndexerXml(xml, {
      pack: PACK,
      searchItem: {
        expectedTitle: "Sunken Bells",
        expectedAuthor: "Marla Ostrand",
        titleMatchVariations: ["Sunken Bells"],
        authorMatchVariations: ["Marla Ostrand"],
        mediaType: "book",
        externalId: "Sunken Bells Marla Ostrand",
        imdbId: null,
        year: null,
        yearMatchingTolerance: null,
      },
    });

    expect(out).toContain("Marla Ostrand - Sunken Bells");
    // renameForBooksAndAudio keeps the unmatched tail as `-[Rest]`, so the
    // full rewritten title is the `Author - Title` form plus that suffix.
    expect(out).toContain("<title>Marla Ostrand - Sunken Bells-[GERMAN.2026.MP3-128kbps]</title>");
  });
});
