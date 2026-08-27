import { describe, expect, it } from "vitest";
import { aggregatePlugins } from "@/domain/plugins/aggregate.js";
import { swedishUmlauts } from "@/domain/plugins/swedish-umlauts/index.js";
import { generateVariations } from "@/domain/variations/generate.js";

const swedishPack = aggregatePlugins([swedishUmlauts]);

describe("swedish-umlauts plugin", () => {
  it("Bärenstark → contains single-letter and digraph variants", () => {
    const v = generateVariations("Bärenstark", "tv", swedishPack);
    expect(v).toContain("Bärenstark");
    expect(v).toContain("Barenstark"); // ä → a
    expect(v).toContain("Baerenstark"); // ä → ae
  });

  it("Köpenick → both forms", () => {
    const v = generateVariations("Köpenick", "tv", swedishPack);
    expect(v).toContain("Kopenick"); // ö → o
    expect(v).toContain("Koepenick"); // ö → oe
  });

  it("Ångström → handles Å (ring) plus ö", () => {
    const v = generateVariations("Ångström", "tv", swedishPack);
    expect(v).toContain("Ångström");
    expect(v).toContain("Angstrom"); // single-letter map: Å→A, ö→o
    expect(v).toContain("AAngstroem"); // digraph map: Å→AA, ö→oe
  });

  it("does not strip German articles when only Swedish is enabled", () => {
    const v = generateVariations("Die Hütte", "tv", swedishPack);
    // Without the German plugin's article list, "Die" stays as part of the title.
    expect(v.every((x) => x.toLowerCase().startsWith("die"))).toBe(true);
  });

  it("preserves case when romanizing", () => {
    const v = generateVariations("ÅÄÖ", "tv", swedishPack);
    expect(v).toContain("AAO"); // wait - Ö → O (single), so ÅÄÖ → AAO under single map
  });
});

describe("swedish-umlauts: digraph case-correctness", () => {
  it("uppercase Å → AA (not Aa)", () => {
    const v = generateVariations("Åland", "tv", swedishPack);
    expect(v).toContain("AAland");
  });
});
