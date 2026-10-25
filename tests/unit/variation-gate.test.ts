import { describe, expect, it } from "vitest";
import { indexerHost, isVariationSearchEnabled } from "@/server/variation-gate";

const global = {
  tvVariationSearch: true,
  movieVariationSearch: false,
  audioVariationSearch: true,
  bookVariationSearch: false,
};

describe("isVariationSearchEnabled", () => {
  it("uses the global switch of the media type without an indexer row", () => {
    expect(isVariationSearchEnabled(global, undefined, "tv")).toBe(true);
    expect(isVariationSearchEnabled(global, undefined, "movie")).toBe(false);
    expect(isVariationSearchEnabled(global, undefined, "audio")).toBe(true);
    expect(isVariationSearchEnabled(global, undefined, "book")).toBe(false);
  });

  it("lets an indexer row win over the global switches", () => {
    const row = { tv: false, movie: true, audio: false, book: true };
    expect(isVariationSearchEnabled(global, row, "tv")).toBe(false);
    expect(isVariationSearchEnabled(global, row, "movie")).toBe(true);
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
