import { describe, expect, it } from "vitest";
import { generateForTvMovie } from "@/domain/variations/tv-movie";
import { aggregatePlugins, BUILTIN_PLUGINS } from "@/domain/plugins";
import { VARIATION_EXAMPLE } from "@/app/(admin)/settings/_lib/settings-types";

// The search-behaviour UI shows which extra queries a fan-out actually sends.
// Copy that claims something the code does not do is worse than no copy, so
// the example is replayed through the real variation generator here. If the
// generator changes, this fails and the UI text has to be corrected with it.
const PACK = aggregatePlugins(BUILTIN_PLUGINS.filter((p) => p.id === "german-umlauts"));

function generate() {
  return generateForTvMovie(
    {
      germanTitle: VARIATION_EXAMPLE.germanTitle,
      expectedTitle: VARIATION_EXAMPLE.expectedTitle,
      aliases: null,
      mediaType: "tv",
    },
    PACK,
  );
}

describe("search-behaviour example matches the real variation output", () => {
  it("shows exactly what the generator produces, in generator order", () => {
    expect(generate().titleSearchVariations).toEqual([...VARIATION_EXAMPLE.variations]);
  });

  it("shows at most as many variations as the default cap of three", () => {
    expect(VARIATION_EXAMPLE.variations.length).toBeLessThanOrEqual(3);
  });

  it("uses a German title with umlauts, or the example would show nothing", () => {
    // A title without umlauts collapses to a single variation and would make
    // the example pointless.
    expect(VARIATION_EXAMPLE.variations.length).toBeGreaterThan(1);
  });
});
