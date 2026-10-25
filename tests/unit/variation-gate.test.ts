import { describe, expect, it } from "vitest";
import { indexerHost, isVariationSearchEnabled, variationCap } from "@/server/variation-gate";

const global = {
  tvVariationSearch: true,
  movieVariationSearch: false,
  audioVariationSearch: true,
  bookVariationSearch: false,
  tvMaxTitleVariations: 1,
  movieMaxTitleVariations: 2,
  audioMaxTitleVariations: 3,
  bookMaxTitleVariations: 0,
};

const row = {
  tv: false,
  movie: true,
  audio: false,
  book: true,
  tvMax: 5,
  movieMax: 0,
  audioMax: 7,
  bookMax: 4,
};

describe("isVariationSearchEnabled", () => {
  it("uses the global switch of the media type without an indexer row", () => {
    expect(isVariationSearchEnabled(global, undefined, "tv")).toBe(true);
    expect(isVariationSearchEnabled(global, undefined, "movie")).toBe(false);
    expect(isVariationSearchEnabled(global, undefined, "audio")).toBe(true);
    expect(isVariationSearchEnabled(global, undefined, "book")).toBe(false);
  });

  it("lets an indexer row win over the global switches", () => {
    expect(isVariationSearchEnabled(global, row, "tv")).toBe(false);
    expect(isVariationSearchEnabled(global, row, "movie")).toBe(true);
  });
});

describe("variationCap", () => {
  it("uses the global cap of the media type without an indexer row", () => {
    expect(variationCap(global, undefined, "tv")).toBe(1);
    expect(variationCap(global, undefined, "movie")).toBe(2);
    expect(variationCap(global, undefined, "audio")).toBe(3);
    expect(variationCap(global, undefined, "book")).toBe(0);
  });

  it("lets an indexer row win over the global caps, zero included", () => {
    expect(variationCap(global, row, "tv")).toBe(5);
    expect(variationCap(global, row, "movie")).toBe(0);
    expect(variationCap(global, row, "audio")).toBe(7);
    expect(variationCap(global, row, "book")).toBe(4);
  });
});

describe("indexerHost", () => {
  it("keeps host and port, drops the path, lower-cases", () => {
    expect(indexerHost("Api.Example-Indexer.test:8443/api/v1")).toBe(
      "api.example-indexer.test:8443",
    );
    expect(indexerHost("idx.test")).toBe("idx.test");
  });
});
