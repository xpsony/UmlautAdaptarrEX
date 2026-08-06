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
