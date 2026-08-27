import { describe, expect, it } from "vitest";
import { canonicalImdbId } from "@/lib/imdb-id";

describe("canonicalImdbId", () => {
  it("adds the tt prefix to a numeric id", () => {
    expect(canonicalImdbId("1234567")).toBe("tt1234567");
  });

  it("keeps an already-prefixed id as is", () => {
    expect(canonicalImdbId("tt1234567")).toBe("tt1234567");
  });

  it("normalises an uppercase prefix", () => {
    expect(canonicalImdbId("TT1234567")).toBe("tt1234567");
  });

  it("trims surrounding whitespace", () => {
    expect(canonicalImdbId("  tt1234567  ")).toBe("tt1234567");
  });

  it("preserves leading zeros, because they are part of the id", () => {
    expect(canonicalImdbId("0000900")).toBe("tt0000900");
  });

  it("rejects anything that is not digits after the prefix", () => {
    expect(canonicalImdbId("tt12a4567")).toBeNull();
    expect(canonicalImdbId("")).toBeNull();
    expect(canonicalImdbId("tt")).toBeNull();
    expect(canonicalImdbId("not-an-id")).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(canonicalImdbId(null)).toBeNull();
    expect(canonicalImdbId(undefined)).toBeNull();
  });
});
