import { describe, expect, it } from "vitest";
import {
  buildSearchItem,
  generateVariations,
} from "@/domain/variations/index.js";

describe("generateVariations (TV)", () => {
  it("generates umlaut-variants for German titles", () => {
    const v = generateVariations("Bärenflüstern", "tv");
    expect(v).toContain("Bärenflüstern");
    expect(v).toContain("Baerenfluestern");
    expect(v).toContain("Barenflustern");
  });

  it("strips article 'Die' recursively", () => {
    const v = generateVariations("Die Hütte", "tv");
    expect(v).toContain("Die Hütte");
    expect(v).toContain("Hütte");
    expect(v).toContain("Huette");
  });

  it("handles dashes (with/without/with-space)", () => {
    const v = generateVariations("Realm-of-Ravens", "tv");
    expect(v).toContain("Realm-of-Ravens");
    expect(v).toContain("RealmofRavens");
    expect(v.some((x) => x.toLowerCase() === "realmofravens")).toBe(true);
    expect(v.some((x) => x.toLowerCase() === "realm of ravens")).toBe(true);
  });

  it("returns empty for empty/null", () => {
    expect(generateVariations(null, "tv")).toEqual([]);
    expect(generateVariations("", "tv")).toEqual([]);
  });

  it("does not strip an article prefix from a longer word (BUG-022 regression guard)", () => {
    // "Theory of Everything" starts with the letters "The" but the article
    // regex requires a trailing space, so it must not collapse to "ory of …".
    const v = generateVariations("Theory of Everything", "tv");
    expect(v).toContain("Theory of Everything");
    expect(v.some((x) => x.startsWith("ory "))).toBe(false);
  });
});

describe("buildSearchItem (TV)", () => {
  it("propagates year suffix from expectedTitle to germanTitle", () => {
    const item = buildSearchItem({
      arrId: 1,
      externalId: "385925",
      title: "Aether: The Final Breeze (2024)",
      expectedTitle: "Aether: The Final Breeze (2024)",
      germanTitle: "Aether: Der Herr der Lüfte",
      aliases: ["Aether: Der Herr der vier Lüfte"],
      mediaType: "tv",
    });
    // germanTitle should now have the year appended
    expect(item.germanTitle).toMatch(/2024/);
    expect(item.aliases?.every((a) => a.includes("2024"))).toBe(true);
  });

  it("expands (DE)-suffix to GERMAN", () => {
    const item = buildSearchItem({
      arrId: 2,
      externalId: "1",
      title: "Foo (DE)",
      expectedTitle: "Foo (DE)",
      germanTitle: "Foo (DE)",
      aliases: null,
      mediaType: "tv",
    });
    expect(item.titleSearchVariations.some((v) => v.includes("GERMAN"))).toBe(
      true,
    );
  });

  it("expands 'Germany' suffix to GERMAN", () => {
    const item = buildSearchItem({
      arrId: 3,
      externalId: "1",
      title: "Outpost Germany",
      expectedTitle: "Outpost Germany",
      germanTitle: "Outpost Germany",
      aliases: null,
      mediaType: "tv",
    });
    expect(item.titleSearchVariations.some((v) => v.includes("GERMAN"))).toBe(
      true,
    );
  });
});

describe("buildSearchItem (audio/book)", () => {
  it("generates separate author and title variations", () => {
    const item = buildSearchItem({
      arrId: 1,
      externalId: "x",
      title: "Best of Die Wölfe",
      expectedTitle: "Best of Die Wölfe",
      expectedAuthor: "Die Wölfe",
      mediaType: "audio",
    });
    expect(item.authorMatchVariations.some((v) => v.includes("Die"))).toBe(
      true,
    );
    // Title should have author removed for matching
    expect(item.titleMatchVariations.some((v) => /best of/i.test(v))).toBe(
      true,
    );
  });

  it("adds 'Lastname, Firstnames' alternative for books", () => {
    const item = buildSearchItem({
      arrId: 1,
      externalId: "x",
      title: "The Wanderer",
      expectedTitle: "The Wanderer",
      expectedAuthor: "Jonas Robert Storm",
      mediaType: "book",
    });
    // getCleanTitle strips the comma; the alternative form "Storm, Jonas Robert"
    // is normalised to "Storm Jonas Robert" in matching variations.
    expect(
      item.authorMatchVariations.some((v) => /^Storm\s+Jonas/.test(v)),
    ).toBe(true);
  });
});
