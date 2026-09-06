import { describe, expect, it } from "vitest";
import { SettingsSchema, SYNC_PRESETS } from "@/schemas/settings";

const partial = SettingsSchema.partial();

describe("sync interval settings", () => {
  it("defaults to a 10-minute quick sync and a 24-hour full sync", () => {
    const full = SettingsSchema.parse({});
    expect(full.syncIntervalMinutes).toBe(10);
    expect(full.fullSyncIntervalHours).toBe(24);
  });

  it("accepts 0 as 'quick sync off'", () => {
    expect(partial.parse({ syncIntervalMinutes: 0 }).syncIntervalMinutes).toBe(0);
  });

  it("rejects a quick-sync interval between 1 and 4 minutes", () => {
    expect(() => partial.parse({ syncIntervalMinutes: 3 })).toThrow();
  });

  it("rejects a quick-sync interval above a day", () => {
    expect(() => partial.parse({ syncIntervalMinutes: 1441 })).toThrow();
  });

  it("rejects a fractional quick-sync interval", () => {
    expect(() => partial.parse({ syncIntervalMinutes: 7.5 })).toThrow();
  });

  it("rejects a full-sync interval outside 1 to 168 hours", () => {
    expect(() => partial.parse({ fullSyncIntervalHours: 0 })).toThrow();
    expect(() => partial.parse({ fullSyncIntervalHours: 169 })).toThrow();
  });

  it("every preset satisfies the schema", () => {
    for (const preset of Object.values(SYNC_PRESETS)) {
      expect(() => partial.parse(preset)).not.toThrow();
    }
  });
});
