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

  it("defaults the variation cap to one", () => {
    expect(SettingsSchema.parse({}).maxTitleVariations).toBe(1);
  });

  it("accepts a cap of one", () => {
    expect(partial.parse({ maxTitleVariations: 1 }).maxTitleVariations).toBe(1);
  });

  it("accepts a cap of zero - no German variations, tail still searched", () => {
    expect(partial.parse({ maxTitleVariations: 0 }).maxTitleVariations).toBe(0);
  });

  it("rejects a negative cap", () => {
    expect(() => partial.parse({ maxTitleVariations: -1 })).toThrow();
  });

  it("rejects a cap above twenty", () => {
    expect(() => partial.parse({ maxTitleVariations: 21 })).toThrow();
  });

  it("rejects a fractional cap", () => {
    expect(() => partial.parse({ maxTitleVariations: 2.5 })).toThrow();
  });
});
