import { describe, expect, it } from "vitest";
import { CHANGELOG, latestChangelog, unseenSince } from "@/lib/changelog";

describe("latestChangelog", () => {
  it("returns the first entry of the changelog array", () => {
    expect(latestChangelog()).toBe(CHANGELOG[0]);
  });

  it("matches the version of the first entry", () => {
    const latest = latestChangelog();
    expect(latest?.version).toBe(CHANGELOG[0]?.version);
  });
});

describe("unseenSince", () => {
  it("returns an empty array when no version was seen yet", () => {
    expect(unseenSince(null)).toEqual([]);
    expect(unseenSince(undefined)).toEqual([]);
    expect(unseenSince("")).toEqual([]);
  });

  it("returns an empty array when the seen version is the latest", () => {
    const latestVersion = CHANGELOG[0]?.version;
    expect(latestVersion).toBeDefined();
    expect(unseenSince(latestVersion)).toEqual([]);
  });

  it("returns only the latest entry when the seen version is unknown", () => {
    const result = unseenSince("0.0.0-not-a-real-version");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(CHANGELOG[0]);
  });

  // Guards against an off-by-one in the slice: the seen version itself must
  // not appear, only entries newer than it.
  it("does not include the seen version in the result", () => {
    const seen = CHANGELOG[0]?.version;
    expect(seen).toBeDefined();
    const result = unseenSince(seen);
    expect(result.find((e) => e.version === seen)).toBeUndefined();
  });

  // unseenSince(oldest) must NOT include the oldest entry itself (that's the
  // "seen" mark), so the result equals "everything before the oldest" which
  // is empty by definition — regardless of how many entries CHANGELOG has.
  it("does not include the oldest entry when it is passed as seen", () => {
    const oldestVersion = CHANGELOG.at(-1)?.version;
    expect(oldestVersion).toBeDefined();
    const result = unseenSince(oldestVersion);
    expect(result.find((e) => e.version === oldestVersion)).toBeUndefined();
  });
});
