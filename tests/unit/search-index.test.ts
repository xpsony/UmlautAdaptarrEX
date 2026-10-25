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
