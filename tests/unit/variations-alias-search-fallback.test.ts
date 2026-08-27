import { describe, expect, it } from "vitest";
import { buildSearchItem } from "@/domain/variations/index";
import { generateForTvMovie } from "@/domain/variations/tv-movie";

// Regression cover for the two field reports on the German title never
// reaching the indexer. Titles below are invented stand-ins for the reported
// shows:
//
//   A) Sonarr holds the ENGLISH TVDB name and the German name exists only in
//      the alias list. Before the fix the German name was usable for
//      *matching* but never *searched*, so the indexer was only ever asked
//      for the English title and found nothing.
//   B) A real `de` title resolved, so both names were already being sent.
//      That path must stay byte-identical.
//
// The promotion is deliberately bounded (3 aliases, Latin script only)
// because the legacy search issues one indexer request per search variation
// with a hard cap of 10.

describe("alias search fallback (no German title)", () => {
  it("A) promotes the German alias to a search variation", () => {
    const item = buildSearchItem({
      arrId: 1,
      externalId: "999001",
      title: "Kai & Nora go on holiday",
      expectedTitle: "Kai & Nora go on holiday",
      germanTitle: null,
      titlesByLang: null,
      mediaType: "tv",
      aliases: ["Kai & Nora machen Urlaub"],
      year: 2026,
    });
    expect(item.germanTitle).toBeNull();
    expect(item.titleSearchVariations).toContain("Kai Nora machen Urlaub");
    // Still matchable, as before.
    expect(item.titleMatchVariations).toContain("Kai Nora machen Urlaub");
  });

  it("B) a resolved German title leaves the search variations untouched", () => {
    const withAliases = generateForTvMovie({
      germanTitle: "Das Rennen um die Krone",
      titlesByLang: { de: "Das Rennen um die Krone" },
      expectedTitle: "The Race for the Crown",
      aliases: ["Race for the Crown", "Chase for the Crown"],
      mediaType: "tv",
    });
    const withoutAliases = generateForTvMovie({
      germanTitle: "Das Rennen um die Krone",
      titlesByLang: { de: "Das Rennen um die Krone" },
      expectedTitle: "The Race for the Crown",
      aliases: null,
      mediaType: "tv",
    });
    expect(withAliases.titleSearchVariations).toEqual(withoutAliases.titleSearchVariations);
    expect(withAliases.titleSearchVariations).toContain("Das Rennen um die Krone");
  });

  it("drops non-Latin aliases from the search fallback but keeps them matchable", () => {
    const out = generateForTvMovie({
      germanTitle: null,
      expectedTitle: "Ember: Steel Angel",
      aliases: [
        "エンバー: スチールエンジェル",
        "余烬：钢铁天使",
        "Эмбер - Стальной Ангел",
        "Ember: Ange d'Acier",
      ],
      mediaType: "movie",
    });
    const search = out.titleSearchVariations.join(" | ");
    expect(search).not.toContain("エンバー");
    expect(search).not.toContain("余烬");
    expect(search).not.toContain("Эмбер");
    // The Latin alias survives; the apostrophe is stripped by getCleanTitle
    // like any other special character.
    expect(out.titleSearchVariations).toContain("Ember Ange dAcier");
    // Match variations are unfiltered — a release named in any script can
    // still be recognised.
    expect(out.titleMatchVariations.join(" | ")).toContain("Ember Ange dAcier");
  });

  it("promotes at most 3 aliases so the 10-request search cap is not exhausted", () => {
    const out = generateForTvMovie({
      germanTitle: null,
      expectedTitle: "Some Show",
      aliases: ["Alias Eins", "Alias Zwei", "Alias Drei", "Alias Vier", "Alias Fuenf"],
      mediaType: "tv",
    });
    const search = out.titleSearchVariations.join(" | ");
    expect(search).toContain("Alias Eins");
    expect(search).toContain("Alias Zwei");
    expect(search).toContain("Alias Drei");
    expect(search).not.toContain("Alias Vier");
    expect(search).not.toContain("Alias Fuenf");
  });

  it("skips an alias that cleans down to the expectedTitle", () => {
    // The search route appends the expectedTitle itself, so an alias equal to
    // it would burn a request slot on a duplicate query. "Nordwind (US)" and
    // "Nordwind US" clean to the same string.
    const out = generateForTvMovie({
      germanTitle: null,
      expectedTitle: "Nordwind (US)",
      aliases: ["Nordwind US", "Nordwind Bürohaus"],
      mediaType: "tv",
    });
    expect(out.titleSearchVariations).toContain("Nordwind Bürohaus");
    expect(out.titleSearchVariations).not.toContain("Nordwind US");
  });

  it("is a no-op when there are no aliases at all", () => {
    const out = generateForTvMovie({
      germanTitle: null,
      expectedTitle: "Endloszug",
      aliases: null,
      mediaType: "tv",
    });
    expect(out.titleSearchVariations).toEqual([]);
  });
});
