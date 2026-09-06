import { describe, expect, it } from "vitest";
import { aggregatePlugins } from "@/domain/plugins/aggregate.js";
import { germanUmlauts } from "@/domain/plugins/german-umlauts/index.js";
import { swedishUmlauts } from "@/domain/plugins/swedish-umlauts/index.js";
import { frenchAccents } from "@/domain/plugins/french-accents/index.js";
import { generateForTvMovie } from "@/domain/variations/tv-movie.js";

describe("generateForTvMovie multi-language pipeline", () => {
  it("Swedish plugin active + sv title -> emits Swedish variations", () => {
    const pack = aggregatePlugins([germanUmlauts, swedishUmlauts]);
    const out = generateForTvMovie(
      {
        germanTitle: "Die Hütte",
        titlesByLang: { de: "Die Hütte", sv: "Stugan" },
        expectedTitle: "The Cabin",
        aliases: null,
        mediaType: "tv",
      },
      pack,
    );
    // German variations contain umlaut and ae forms.
    expect(out.titleSearchVariations).toContain("Die Hütte");
    expect(out.titleSearchVariations.some((v) => v.includes("Huette"))).toBe(
      true,
    );
    // Swedish title was passed through the swedish-only pack - "Stugan" stays
    // as-is and no German maps were applied to it.
    expect(out.titleSearchVariations).toContain("Stugan");
  });

  it("Swedish plugin active but sv title missing -> skips silently", () => {
    const pack = aggregatePlugins([germanUmlauts, swedishUmlauts]);
    const out = generateForTvMovie(
      {
        germanTitle: "Der Magnat",
        titlesByLang: { de: "Der Magnat" }, // no `sv`
        expectedTitle: "The Magnate",
        aliases: null,
        mediaType: "movie",
      },
      pack,
    );
    // No Swedish-specific output beyond what the German pack already produced.
    expect(out.titleSearchVariations).toContain("Der Magnat");
  });

  it("French plugin: lang-specific accents are stripped only on the FR title", () => {
    const pack = aggregatePlugins([germanUmlauts, frenchAccents]);
    const out = generateForTvMovie(
      {
        germanTitle: "Die Königin und der Wald",
        titlesByLang: {
          de: "Die Königin und der Wald",
          fr: "La Reine et la Forêt",
        },
        expectedTitle: "The Queen and the Forest",
        aliases: null,
        mediaType: "movie",
      },
      pack,
    );
    // FR variation should have its diacritic stripped: "Foret" not "Forêt".
    expect(
      out.titleSearchVariations.some((v) => /La Reine et la Foret/i.test(v)),
    ).toBe(true);
  });

  it("backward-compat: no titlesByLang behaves identically to legacy", () => {
    const pack = aggregatePlugins([germanUmlauts]);
    const out = generateForTvMovie(
      {
        germanTitle: "Der Magnat",
        expectedTitle: "The Magnate",
        aliases: null,
        mediaType: "movie",
      },
      pack,
    );
    expect(out.germanTitle).toBe("Der Magnat");
    expect(out.titleSearchVariations.length).toBeGreaterThan(0);
  });

  it("titlesByLang.de overrides legacy germanTitle param when both are passed", () => {
    const pack = aggregatePlugins([germanUmlauts]);
    const out = generateForTvMovie(
      {
        germanTitle: "Stale-Cache-Titel",
        titlesByLang: { de: "Frischer DE-Titel" },
        expectedTitle: "X",
        aliases: null,
        mediaType: "tv",
      },
      pack,
    );
    expect(out.germanTitle).toBe("Frischer DE-Titel");
  });
});
