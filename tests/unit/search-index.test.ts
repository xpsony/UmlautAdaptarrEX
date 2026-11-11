import { describe, expect, it } from "vitest";
import { SearchItemIndex } from "@/server/search-index";
import { DEFAULT_INSTANCE_OPTIONS, type CachedSearchItemInput } from "@/server/search-item";
import { aggregatePlugins, BUILTIN_PLUGINS } from "@/domain/plugins";

const PACK = aggregatePlugins(BUILTIN_PLUGINS.filter((p) => p.defaultEnabled));
const resolveOptions = () => DEFAULT_INSTANCE_OPTIONS;

function makeItem(over: Partial<CachedSearchItemInput> = {}): CachedSearchItemInput {
  return {
    id: "id-1",
    arrInstanceId: "inst-1",
    arrId: 1,
    externalId: "100",
    imdbId: null,
    title: "Realm of Ravens",
    expectedTitle: "Realm of Ravens",
    expectedAuthor: null,
    germanTitle: null,
    mediaType: "tv",
    year: null,
    titleSearchVariations: [],
    titleMatchVariations: ["Realm of Ravens"],
    authorMatchVariations: [],
    ...over,
  };
}

describe("SearchItemIndex", () => {
  it("indexes and retrieves by media type and external id", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem(), PACK);
    expect(index.getByExternalId("tv", "100")?.title).toBe("Realm of Ravens");
    expect(index.getByExternalId("movie", "100")).toBeNull();
  });

  it("getByImdbId finds an item by its IMDb id and ignores items without one", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ externalId: "900", imdbId: "tt0000900" }), PACK);
    index.indexItem(makeItem({ id: "id-2", externalId: "901" }), PACK);
    expect(index.getByImdbId("tt0000900")?.externalId).toBe("900");
    expect(index.getByImdbId("tt9999999")).toBeNull();
  });

  it("findByTitle returns the longest matching variation", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ titleMatchVariations: ["Realm", "Realm of Ravens"] }), PACK);
    const hit = index.findByTitle("tv", "Realm of Ravens S01E01 Pilot", PACK, resolveOptions);
    expect(hit?.externalId).toBe("100");
  });

  it("removeItem drops the item from every prefix bucket, not just the id map", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ titleMatchVariations: ["Realm of Ravens"] }), PACK);
    index.removeItem("tv", "100");
    expect(index.getByExternalId("tv", "100")).toBeNull();
    expect(
      index.findByTitle("tv", "Realm of Ravens S01E01 Pilot", PACK, resolveOptions),
    ).toBeNull();
  });

  it("removeItem also clears the IMDb mapping", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ externalId: "900", imdbId: "tt0000900" }), PACK);
    index.removeItem("tv", "900");
    expect(index.getByImdbId("tt0000900")).toBeNull();
  });

  it("removeItemsForInstance keeps other instances intact", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ externalId: "1", arrInstanceId: "inst-1" }), PACK);
    index.indexItem(makeItem({ id: "id-2", externalId: "2", arrInstanceId: "inst-2" }), PACK);
    index.removeItemsForInstance("inst-1");
    expect(index.getByExternalId("tv", "1")).toBeNull();
    expect(index.getByExternalId("tv", "2")).not.toBeNull();
  });

  it("rejects a year-mismatched candidate when the release names a different year", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ year: 2025, titleMatchVariations: ["Hafen im Winter"] }), PACK);
    const hit = index.findByTitle("tv", "Hafen im Winter 2019 1080p", PACK, resolveOptions);
    expect(hit).toBeNull();
  });

  it("clear empties every map", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ imdbId: "tt0000100" }), PACK);
    index.clear();
    expect(index.getByExternalId("tv", "100")).toBeNull();
    expect(index.getByImdbId("tt0000100")).toBeNull();
  });

  it("registers every alias as a lookup key for the same item", () => {
    const index = new SearchItemIndex();
    index.indexItem(
      makeItem({
        mediaType: "book",
        externalId: "Sunken Bells Marla Ostrand",
        externalIdAliases: ["Sunken Bells Marla Ostrand Tidewater Chronicles"],
        expectedAuthor: "Marla Ostrand",
        title: "Sunken Bells",
      }),
      PACK,
    );

    const viaPrimary = index.getByExternalId("book", "Sunken Bells Marla Ostrand");
    const viaAlias = index.getByExternalId(
      "book",
      "Sunken Bells Marla Ostrand Tidewater Chronicles",
    );
    expect(viaPrimary?.title).toBe("Sunken Bells");
    expect(viaAlias).toBe(viaPrimary);
  });

  it("removeItem drops the aliases along with the primary key", () => {
    const index = new SearchItemIndex();
    index.indexItem(
      makeItem({
        mediaType: "book",
        externalId: "Sunken Bells Marla Ostrand",
        externalIdAliases: ["Sunken Bells Marla Ostrand Tidewater Chronicles"],
      }),
      PACK,
    );
    index.removeItem("book", "Sunken Bells Marla Ostrand");

    expect(index.getByExternalId("book", "Sunken Bells Marla Ostrand")).toBeNull();
    expect(
      index.getByExternalId("book", "Sunken Bells Marla Ostrand Tidewater Chronicles"),
    ).toBeNull();
  });

  it("removeItem leaves an alias alone once another item has taken it over", () => {
    const index = new SearchItemIndex();
    index.indexItem(
      makeItem({
        id: "id-old",
        mediaType: "book",
        externalId: "Old Primary",
        externalIdAliases: ["Shared Key"],
      }),
      PACK,
    );
    index.indexItem(
      makeItem({
        id: "id-new",
        mediaType: "book",
        externalId: "Shared Key",
        title: "Winter Lanterns",
      }),
      PACK,
    );

    index.removeItem("book", "Old Primary");

    expect(index.getByExternalId("book", "Shared Key")?.title).toBe("Winter Lanterns");
  });

  it("removeItemsForInstance drops alias keys too", () => {
    const index = new SearchItemIndex();
    index.indexItem(
      makeItem({
        arrInstanceId: "inst-listenarr",
        mediaType: "book",
        externalId: "Primary Key",
        externalIdAliases: ["Alias Key"],
      }),
      PACK,
    );
    index.removeItemsForInstance("inst-listenarr");

    expect(index.getByExternalId("book", "Primary Key")).toBeNull();
    expect(index.getByExternalId("book", "Alias Key")).toBeNull();
  });

  it("indexes an item without aliases exactly as before", () => {
    const index = new SearchItemIndex();
    index.indexItem(makeItem({ externalId: "500" }), PACK);
    expect(index.getByExternalId("tv", "500")?.externalId).toBe("500");
  });
});

describe("SearchItemIndex.findByTitle (audio)", () => {
  // Music releases start with the artist ("Michael Jackson - Thriller"), so
  // audio items are looked up by author + title, not by the title alone.
  function album(
    externalId: string,
    author: string,
    title: string,
    authorMatchVariations: string[] = [author],
    titleMatchVariations: string[] = [title],
  ): CachedSearchItemInput {
    return makeItem({
      id: `id-${externalId}`,
      externalId,
      mediaType: "audio",
      title,
      expectedTitle: title,
      expectedAuthor: author,
      titleMatchVariations,
      authorMatchVariations,
    });
  }

  function find(index: SearchItemIndex, release: string) {
    return index.findByTitle("audio", release, PACK, resolveOptions);
  }

  it("finds the album named after the artist", () => {
    const index = new SearchItemIndex();
    index.indexItem(album("thriller", "Michael Jackson", "Thriller"), PACK);
    expect(find(index, "Michael Jackson - Thriller (1982) FLAC")?.externalId).toBe("thriller");
  });

  it("does not hand every release of the artist to an album named like the artist", () => {
    const index = new SearchItemIndex();
    index.indexItem(album("michael", "Michael Jackson", "Michael"), PACK);
    index.indexItem(album("alanis", "Alanis Morissette", "Alanis"), PACK);
    expect(find(index, "Michael Jackson - Thriller (1982) FLAC")).toBeNull();
    expect(
      find(index, "Alanis Morissette - Good Weather For Immaculate Conception (2026) FLAC"),
    ).toBeNull();
    // The self-titled release itself is still found.
    expect(find(index, "Michael Jackson - Michael (2010) FLAC")?.externalId).toBe("michael");
  });

  it("does not match an album title at the start of another artist's release", () => {
    const index = new SearchItemIndex();
    index.indexItem(album("green", "R.E.M.", "Green", ["R E M"]), PACK);
    index.indexItem(album("trailer", "Ash", "Trailer"), PACK);
    expect(find(index, "Green Lung - Necropolitan (2026) FLAC")).toBeNull();
    expect(find(index, "Trailer Trash Tracys - Althaea (2017) WEB")).toBeNull();
    expect(find(index, "R.E.M. - Green (1988) FLAC")?.externalId).toBe("green");
  });

  it("finds a release that spells the artist's umlaut differently", () => {
    const index = new SearchItemIndex();
    index.indexItem(
      album(
        "weiss",
        "Böhse Onkelz",
        "Weiß",
        ["Böhse Onkelz", "Boehse Onkelz", "Bohse Onkelz"],
        ["Weiß", "Weiss"],
      ),
      PACK,
    );
    expect(find(index, "Boehse.Onkelz-Weiss-DE-CD-FLAC-1993-GROUP")?.externalId).toBe("weiss");
  });

  it("prefers the longest album title", () => {
    const index = new SearchItemIndex();
    index.indexItem(album("britney", "Britney Spears", "Britney"), PACK);
    index.indexItem(album("britney-jean", "Britney Spears", "Britney Jean"), PACK);
    expect(find(index, "Britney Spears - Britney Jean (Deluxe Edition) 2013")?.externalId).toBe(
      "britney-jean",
    );
  });

  it.each([
    ["1995 first", false],
    ["2014 first", true],
  ])("picks the album by year when two albums share a lookup key (%s)", (_label, reversed) => {
    // "The Infamous…" (1995) and "The Infamous Mobb Deep" (2014, artist name
    // stripped from the title) both end up under "mobbdeep" + "theinfamous".
    const albums = [
      {
        ...album("infamous", "Mobb Deep", "The Infamous…", ["Mobb Deep"], ["The Infamous"]),
        year: 1995,
      },
      {
        ...album(
          "infamous-mobb-deep",
          "Mobb Deep",
          "The Infamous Mobb Deep",
          ["Mobb Deep"],
          ["The Infamous"],
        ),
        year: 2014,
      },
    ];
    const index = new SearchItemIndex();
    for (const a of reversed ? albums.reverse() : albums) index.indexItem(a, PACK);
    expect(find(index, "Mobb Deep - The Infamous (1995) FLAC")?.externalId).toBe("infamous");
    expect(find(index, "Mobb.Deep-The.Infamous.Mobb.Deep-WEB-2014-GROUP")?.externalId).toBe(
      "infamous-mobb-deep",
    );
  });

  it("falls back to the title alone when the item has no author variations", () => {
    const index = new SearchItemIndex();
    index.indexItem(album("thriller", "Michael Jackson", "Thriller", []), PACK);
    expect(find(index, "Thriller (1982) FLAC")?.externalId).toBe("thriller");
  });

  it("removeItem drops an audio item from its author + title buckets", () => {
    const index = new SearchItemIndex();
    index.indexItem(album("thriller", "Michael Jackson", "Thriller"), PACK);
    index.removeItem("audio", "thriller");
    expect(find(index, "Michael Jackson - Thriller (1982) FLAC")).toBeNull();
  });
});
