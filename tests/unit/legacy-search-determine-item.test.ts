import { describe, expect, it } from "vitest";
import { determineSearchItem } from "@/server/routes/legacy/search";
import { SearchItemIndex } from "@/server/search-index";
import type { CachedSearchItem } from "@/server/search-item";
import { aggregatePlugins, BUILTIN_PLUGINS } from "@/domain/plugins";
import { rewriteIndexerXml, type RewriteSearchItem } from "@/domain/xml/rewrite";

const PACK = aggregatePlugins(BUILTIN_PLUGINS.filter((p) => p.defaultEnabled));
const LISTENARR_UA = "Listenarr/1.4.0.0 (+https://github.com/Listenarrs/listenarr)";

/** The slice of AppState that `determineSearchItem` and the rewrite touch. */
interface FakeState {
  getByExternalId: (type: string, id: string) => CachedSearchItem | null;
  findByTitle: () => null;
  toRewriteSearchItem: (item: CachedSearchItem) => RewriteSearchItem;
}

/**
 * A stand-in AppState holding one indexed audiobook. `externalIdAliases` is a
 * parameter so a case can exercise the Listenarr alias path (the series name
 * Listenarr appends to its indexer query) without duplicating the helper.
 */
function stateWithBook(externalIdAliases: string[] | null = null): FakeState {
  const index = new SearchItemIndex();
  index.indexItem(
    {
      id: "id-1",
      arrInstanceId: "inst-1",
      arrId: 7,
      externalId: "Sunken Bells Marla Ostrand",
      externalIdAliases,
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
    // Mirrors AppState.toRewriteSearchItem, which is how handleSearch hands a
    // resolved item to rewriteIndexerXml. Year matching is off here because
    // the fixture has no year.
    toRewriteSearchItem: (item: CachedSearchItem) => ({
      expectedTitle: item.expectedTitle,
      expectedAuthor: item.expectedAuthor,
      titleMatchVariations: item.titleMatchVariations,
      authorMatchVariations: item.authorMatchVariations,
      mediaType: item.mediaType,
      externalId: item.externalId,
      imdbId: item.imdbId ?? null,
      year: item.year,
      yearMatchingTolerance: null,
    }),
  };
}

describe("determineSearchItem, t=search without cat", () => {
  it("falls back to book for a Listenarr user agent", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook() as never, LISTENARR_UA);
    expect(item?.title).toBe("Sunken Bells");
  });

  it("stays null for any other user agent", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook() as never, "Readarr/1.0.0");
    expect(item).toBeNull();
  });

  it("stays null when there is no user agent at all", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook() as never, "");
    expect(item).toBeNull();
  });

  it("resolves a book through its Listenarr series alias", () => {
    // Listenarr searches "Title Author Series"; only the alias carries the
    // series, so without it this query misses the primary key entirely.
    const state = stateWithBook(["Sunken Bells Marla Ostrand Tidewater Chronicles"]);
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand Tidewater Chronicles" });
    const item = determineSearchItem({ type: "search" }, params, state as never, LISTENARR_UA);
    expect(item?.externalId).toBe("Sunken Bells Marla Ostrand");
    expect(item?.expectedAuthor).toBe("Marla Ostrand");
  });

  it("does not resolve the series query when the book carries no alias", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand Tidewater Chronicles" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook() as never, LISTENARR_UA);
    expect(item).toBeNull();
  });

  it("lets the category decide when one is present, whatever the user agent", () => {
    const params = new URLSearchParams({ q: "Sunken Bells Marla Ostrand", cat: "5040" });
    const item = determineSearchItem({ type: "search" }, params, stateWithBook() as never, LISTENARR_UA);
    expect(item).toBeNull();
  });
});

describe("Listenarr end to end", () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item>
<title>Sunken.Bells.Marla.Ostrand.GERMAN.2026.MP3-128kbps</title>
<category>3030</category>
<link>http://indexer.local/dl/1</link>
</item></channel></rss>`;

  /**
   * Mirrors handleSearch: resolve the item off the query, then hand it to the
   * rewrite as `state.toRewriteSearchItem(searchItem)`. Anything the route
   * does between the two is settings plumbing the domain does not need.
   */
  function searchAndRewrite(state: FakeState, q: string): string {
    const params = new URLSearchParams({ q });
    const item = determineSearchItem({ type: "search" }, params, state as never, LISTENARR_UA);
    expect(item).not.toBeNull();
    return rewriteIndexerXml(XML, {
      pack: PACK,
      searchItem: state.toRewriteSearchItem(item as CachedSearchItem),
    });
  }

  it("rewrites a badly named release into author and title", () => {
    // The `category` element is load-bearing: 3030 is the Newznab audiobook
    // id, and without it the rewrite classifies the item out before it ever
    // looks at `searchItem`.
    const out = searchAndRewrite(stateWithBook(), "Sunken Bells Marla Ostrand");

    expect(out).toContain("Marla Ostrand - Sunken Bells");
    // renameForBooksAndAudio keeps the unmatched tail as `-[Rest]`, so the
    // full rewritten title is the `Author - Title` form plus that suffix.
    expect(out).toContain("<title>Marla Ostrand - Sunken Bells-[GERMAN.2026.MP3-128kbps]</title>");
  });

  it("rewrites the same release when Listenarr searched by series", () => {
    const out = searchAndRewrite(
      stateWithBook(["Sunken Bells Marla Ostrand Tidewater Chronicles"]),
      "Sunken Bells Marla Ostrand Tidewater Chronicles",
    );

    expect(out).toContain("<title>Marla Ostrand - Sunken Bells-[GERMAN.2026.MP3-128kbps]</title>");
  });
});
