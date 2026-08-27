import { describe, expect, it } from "vitest";
import { AppState, type CachedSearchItemInput, getAppState } from "@/server/state";
import { normalizeForComparison } from "@/domain/normalization/comparison";

function makeItem(overrides: Partial<CachedSearchItemInput> = {}): CachedSearchItemInput {
  return {
    id: "x",
    arrInstanceId: "inst-1",
    arrId: 1,
    externalId: "100",
    title: "Realm of Ravens",
    expectedTitle: "Realm of Ravens",
    expectedAuthor: null,
    germanTitle: "Lied der Schwarzen Raben",
    mediaType: "tv",
    year: null,
    titleSearchVariations: [],
    titleMatchVariations: ["Realm of Ravens", "Lied der Schwarzen Raben"],
    authorMatchVariations: [],
    ...overrides,
  };
}

describe("AppState in-memory item index", () => {
  it("indexes a fresh item by external id", () => {
    const state = new AppState();
    state.indexItem(makeItem());
    expect(state.getByExternalId("tv", "100")?.title).toBe("Realm of Ravens");
  });

  it("returns null when the external id is unknown", () => {
    const state = new AppState();
    expect(state.getByExternalId("tv", "missing")).toBeNull();
  });

  it("namespaces by media type", () => {
    const state = new AppState();
    state.indexItem(makeItem({ mediaType: "tv", externalId: "1" }));
    state.indexItem(makeItem({ mediaType: "movie", externalId: "1", title: "Movie One" }));
    expect(state.getByExternalId("tv", "1")?.title).toBe("Realm of Ravens");
    expect(state.getByExternalId("movie", "1")?.title).toBe("Movie One");
  });

  it("findByTitle returns the longest matching variation", () => {
    const state = new AppState();
    state.indexItem(
      makeItem({
        externalId: "1",
        titleMatchVariations: ["Realm of Ravens"],
      }),
    );
    const result = state.findByTitle("tv", "Realm of Ravens S01E01 Pilot");
    expect(result?.externalId).toBe("1");
  });

  it("findByTitle returns null when nothing matches", () => {
    const state = new AppState();
    state.indexItem(makeItem());
    expect(state.findByTitle("tv", "Totally unrelated release")).toBeNull();
  });

  it("removeItemsForInstance drops items by arrInstanceId", () => {
    const state = new AppState();
    state.indexItem(
      makeItem({
        arrInstanceId: "inst-1",
        externalId: "1",
      }),
    );
    state.indexItem(
      makeItem({
        arrInstanceId: "inst-2",
        externalId: "2",
        title: "Other",
        titleMatchVariations: ["Other"],
      }),
    );
    state.removeItemsForInstance("inst-1");
    expect(state.getByExternalId("tv", "1")).toBeNull();
    expect(state.getByExternalId("tv", "2")).not.toBeNull();
  });

  it("toRewriteSearchItem extracts the rewrite-relevant fields", () => {
    const state = new AppState();
    state.indexItem(
      makeItem({
        externalId: "rewrite-1",
        expectedAuthor: "Author X",
        titleMatchVariations: ["A", "B"],
        authorMatchVariations: ["Author X"],
      }),
    );
    const item = state.getByExternalId("tv", "rewrite-1");
    expect(item).not.toBeNull();
    if (!item) throw new Error("expected indexed item");
    const rewrite = state.toRewriteSearchItem(item);
    expect(rewrite).toEqual({
      expectedTitle: item.expectedTitle,
      // Forwarded so the rewrite can emit newznab id attributes.
      externalId: item.externalId,
      imdbId: null,
      expectedAuthor: "Author X",
      titleMatchVariations: ["A", "B"],
      authorMatchVariations: ["Author X"],
      mediaType: "tv",
      year: null,
      // Default per-instance options (year-matching on, +/-1 tolerance) are
      // applied even for items whose owning instance hasn't been registered
      // in AppState yet, mirroring the permissive default behaviour.
      yearMatchingTolerance: 1,
    });
  });

  it("indexItem precomputes normalizedMatchVariations parallel to titleMatchVariations", () => {
    const state = new AppState();
    const titleMatchVariations = ["Realm of Ravens", "Lied der Schwarzen Raben"];
    state.indexItem(makeItem({ externalId: "norm-1", titleMatchVariations }));
    const indexed = state.getByExternalId("tv", "norm-1");
    expect(indexed).not.toBeNull();
    if (!indexed) throw new Error("expected indexed item");
    expect(indexed.normalizedMatchVariations).toEqual(
      titleMatchVariations.map((v) => normalizeForComparison(v, state.languagePack)),
    );
  });

  it("indexItem applies the language pack's comparisonMap, not just ASCII lowercasing", () => {
    const state = new AppState();
    // "ß" has no NFD decomposition, so it only folds to "ss" via the German
    // plugin's comparisonMap - unlike "ä", which the generic accent-stripper
    // would flatten to "a" even with an empty/wrong pack. This variation
    // therefore genuinely exercises normalizeForComparison's non-ASCII path
    // and the active pack's mapping, not the ASCII fast path every other
    // test in this file rides (which never touches `pack` at all).
    const variation = "Straße der Dächer";
    state.indexItem(makeItem({ externalId: "umlaut-1", titleMatchVariations: [variation] }));
    const indexed = state.getByExternalId("tv", "umlaut-1");
    expect(indexed).not.toBeNull();
    if (!indexed) throw new Error("expected indexed item");

    // (a) parallel entry matches a fresh normalizeForComparison call against
    // the pack, and is not just the lowercased raw string.
    const expected = normalizeForComparison(variation, state.languagePack);
    expect(expected).toBe("strassederdacher");
    expect(indexed.normalizedMatchVariations).toEqual([expected]);
    expect(indexed.normalizedMatchVariations[0]).not.toBe(variation);

    // (b) findByTitle resolves an ASCII-transliterated query ("Strasse" /
    // "Dacher") that only lines up with the stored variation because both
    // sides fold ß->"ss" and ä->"a" through the same comparisonMap. A pack
    // that failed to apply ß->"ss" (e.g. stale/empty comparisonMap) would
    // strip the bare "ß" as a special char instead, yielding "strae..." -
    // which would NOT prefix-match this query, so this catches that
    // regression end to end.
    const result = state.findByTitle("tv", "Strasse der Dacher S01E01 Pilot");
    expect(result?.externalId).toBe("umlaut-1");
  });
});

describe("getAppState singleton", () => {
  it("returns the same instance on repeated calls", () => {
    expect(getAppState()).toBe(getAppState());
  });
});
