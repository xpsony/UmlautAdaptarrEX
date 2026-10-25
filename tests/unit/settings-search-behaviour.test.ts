import { describe, expect, it } from "vitest";
import { SettingsSchema } from "@/schemas/settings";

const partial = SettingsSchema.partial();

describe("search behaviour settings", () => {
  it("defaults on-demand lookup to on", () => {
    expect(SettingsSchema.parse({}).onDemandLookup).toBe(true);
  });

  it("defaults both variation searches to on for a fresh install", () => {
    const full = SettingsSchema.parse({});
    expect(full.tvVariationSearch).toBe(true);
    expect(full.movieVariationSearch).toBe(true);
  });

  it("defaults the music and book variation searches to on for a fresh install", () => {
    const full = SettingsSchema.parse({});
    expect(full.audioVariationSearch).toBe(true);
    expect(full.bookVariationSearch).toBe(true);
  });

  it("defaults every per-type variation cap to one", () => {
    const full = SettingsSchema.parse({});
    expect(full.tvMaxTitleVariations).toBe(1);
    expect(full.movieMaxTitleVariations).toBe(1);
    expect(full.audioMaxTitleVariations).toBe(1);
    expect(full.bookMaxTitleVariations).toBe(1);
  });

  it("accepts a cap of one", () => {
    expect(partial.parse({ tvMaxTitleVariations: 1 }).tvMaxTitleVariations).toBe(1);
  });

  it("accepts a cap of zero - no German variations, tail still searched", () => {
    expect(partial.parse({ movieMaxTitleVariations: 0 }).movieMaxTitleVariations).toBe(0);
  });

  it("rejects a negative cap", () => {
    expect(() => partial.parse({ audioMaxTitleVariations: -1 })).toThrow();
  });

  it("rejects a cap above twenty", () => {
    expect(() => partial.parse({ bookMaxTitleVariations: 21 })).toThrow();
  });

  it("rejects a fractional cap", () => {
    expect(() => partial.parse({ tvMaxTitleVariations: 2.5 })).toThrow();
  });
});
