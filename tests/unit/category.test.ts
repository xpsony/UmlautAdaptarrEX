import { describe, expect, it } from "vitest";
import {
  getMediaTypeFromCategory,
  getMediaTypeFromNewznabCat,
} from "@/domain/matching/category.js";

describe("getMediaTypeFromCategory", () => {
  it.each([
    ["7000", "book"],
    ["EBook", "book"],
    ["Bücher", "book"],
    ["2000", "movie"],
    ["Movies", "movie"],
    ["Filme", "movie"],
    ["5000", "tv"],
    ["TV", "tv"],
    ["Serien", "tv"],
    ["3030", "book"],
    ["Audiobook", "book"],
    ["Hörbuch", "book"],
    ["3000", "audio"],
    ["Audio", "audio"],
    ["Musik", "audio"],
    // Newznab subcategory IDs: previously returned null and caused the
    // rewrite step to skip the item, so tv/audio/book entries never
    // reached RenameHistory while only-2xxx-tagged movies got through.
    ["5040", "tv"],
    ["5070", "tv"],
    ["2050", "movie"],
    ["3010", "audio"],
    ["3130", "book"],
    ["7020", "book"],
    [null, null],
    [undefined, null],
    ["6000", null],
  ])("category %j -> %j", (input, expected) => {
    expect(getMediaTypeFromCategory(input ?? null)).toBe(expected);
  });

  it("returns the first recognised type from a list", () => {
    // A real indexer may emit ["TV/HD", "5000"] or ["5040", "5000"] -
    // both must classify as tv even when the first entry isn't directly
    // recognisable in isolation (legacy: only the head was checked).
    expect(getMediaTypeFromCategory(["5040", "5000"])).toBe("tv");
    expect(getMediaTypeFromCategory(["unknown", "Movies/HD"])).toBe("movie");
    expect(getMediaTypeFromCategory(["", "  ", "3010"])).toBe("audio");
    expect(getMediaTypeFromCategory([])).toBeNull();
  });
});

describe("getMediaTypeFromNewznabCat", () => {
  it.each([
    ["3000,3010", "audio"],
    ["7000", "book"],
    ["3030", "book"],
    ["5030", "tv"],
    ["2040", "movie"],
    ["9999", null],
  ])("cat %j -> %j", (input, expected) => {
    expect(getMediaTypeFromNewznabCat(input)).toBe(expected);
  });
});
