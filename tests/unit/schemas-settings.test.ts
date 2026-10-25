import { describe, expect, it } from "vitest";
import { SettingsSchema, SettingsUpdateSchema } from "@/schemas/settings";

describe("SettingsSchema.historyRetentionDays", () => {
  it("defaults to 30", () => {
    const parsed = SettingsSchema.parse({});
    expect(parsed.historyRetentionDays).toBe(30);
  });

  it("accepts the bounds 1 and 365", () => {
    expect(SettingsUpdateSchema.parse({ historyRetentionDays: 1 }).historyRetentionDays).toBe(1);
    expect(SettingsUpdateSchema.parse({ historyRetentionDays: 365 }).historyRetentionDays).toBe(
      365,
    );
  });

  it("rejects 0, negative, fractional and >365 values", () => {
    for (const bad of [0, -1, 1.5, 366]) {
      expect(SettingsUpdateSchema.safeParse({ historyRetentionDays: bad }).success).toBe(false);
    }
  });
});

// Issue #152: Zod 4's `.partial()` still applies `.default()` to omitted keys,
// so a partial PUT used to carry every default (proxyPort: 5006 included),
// rejecting saves with 409 under an env-managed proxy port and silently
// resetting every other setting otherwise.
describe("SettingsUpdateSchema", () => {
  it("leaves omitted keys undefined instead of filling in defaults", () => {
    expect(SettingsUpdateSchema.parse({ cacheDurationMinutes: 30 })).toEqual({
      cacheDurationMinutes: 30,
    });
  });

  it("parses an empty body to an empty update", () => {
    expect(SettingsUpdateSchema.parse({})).toEqual({});
  });

  it("still validates the keys that are sent", () => {
    expect(SettingsUpdateSchema.safeParse({ proxyPort: 80 }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ operationMode: "nope" }).success).toBe(false);
  });
});
