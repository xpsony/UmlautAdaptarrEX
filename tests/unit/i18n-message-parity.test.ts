import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/i18n-config";

// Every locale must carry the identical key set. Adding a feature and only
// updating de/en leaves the French and Swedish UI rendering raw key paths -
// which is exactly what happened while the Renaming tab was added.
//
// The default locale is the reference; a key that exists only in a
// translation is just as wrong (a leftover from a removed feature).

const MESSAGES_DIR = path.join(import.meta.dirname, "..", "..", "src", "messages");

function loadKeys(locale: string): Set<string> {
  const raw = readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8");
  const keys = new Set<string>();
  const walk = (node: unknown, prefix: string): void => {
    if (node !== null && typeof node === "object" && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
      return;
    }
    keys.add(prefix);
  };
  walk(JSON.parse(raw), "");
  return keys;
}

describe("message catalogues", () => {
  const reference = loadKeys(DEFAULT_LOCALE);

  it("the reference catalogue is not empty", () => {
    expect(reference.size).toBeGreaterThan(100);
  });

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;

    it(`${locale} has no missing keys`, () => {
      const keys = loadKeys(locale);
      expect([...reference].filter((k) => !keys.has(k)).sort()).toEqual([]);
    });

    it(`${locale} has no keys the reference lacks`, () => {
      const keys = loadKeys(locale);
      expect([...keys].filter((k) => !reference.has(k)).sort()).toEqual([]);
    });
  }
});
