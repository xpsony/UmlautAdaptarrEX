import {describe, expect, it} from "vitest";
import {aggregatePlugins} from "@/domain/plugins/aggregate.js";
import {germanUmlauts} from "@/domain/plugins/german-umlauts/index.js";
import {swedishUmlauts} from "@/domain/plugins/swedish-umlauts/index.js";

describe("aggregatePlugins", () => {
    it("empty input -> identity pack with no plugins", () => {
        const pack = aggregatePlugins([]);
        expect(pack.hasPlugins).toBe(false);
        expect(pack.variationMaps).toEqual([]);
        expect(pack.articles).toEqual([]);
        expect(pack.wordCharsEscaped).toBe("");
        expect(Object.keys(pack.comparisonMap)).toEqual([]);
    });

    it("German only: 2 variation maps, 1 audio map, 6 articles", () => {
        const pack = aggregatePlugins([germanUmlauts]);
        expect(pack.variationMaps).toHaveLength(2);
        expect(pack.audioOnlyMaps).toHaveLength(1);
        expect(pack.articles).toEqual(["Der", "Die", "Das", "The", "An", "A"]);
        expect(pack.combiningMarksToKeep.has("̈")).toBe(true);
    });

    it("German + Swedish: variation maps concatenated (4), word chars deduped", () => {
        const pack = aggregatePlugins([germanUmlauts, swedishUmlauts]);
        expect(pack.variationMaps).toHaveLength(4);
        // Ä and Ö overlap between DE and SE - must appear only once in word chars.
        const chars = pack.wordCharsEscaped.split("");
        const aUmlautCount = chars.filter((c) => c === "Ä").length;
        expect(aUmlautCount).toBe(1);
        // Combining ring above (Å's NFD mark) is preserved.
        expect(pack.combiningMarksToKeep.has("̊")).toBe(true);
    });

    it("Swedish-only: comparison map covers å but not ß", () => {
        const pack = aggregatePlugins([swedishUmlauts]);
        expect(pack.comparisonMap["å"]).toBe("a");
        expect(pack.comparisonMap["ß"]).toBeUndefined();
    });
});
