import type { VariationPlugin } from "../types";

// Swedish romanization conventions:
//   Å/å - written as A/a (single-letter) or AA/aa (digraph)
//   Ä/ä - written as A/a (single-letter) or AE/ae (digraph)
//   Ö/ö - written as O/o (single-letter) or OE/oe (digraph)
const SINGLE_LETTER: Readonly<Record<string, string>> = {
  å: "a",
  ä: "a",
  ö: "o",
  Å: "A",
  Ä: "A",
  Ö: "O",
};

const DIGRAPH: Readonly<Record<string, string>> = {
  å: "aa",
  ä: "ae",
  ö: "oe",
  Å: "AA",
  Ä: "AE",
  Ö: "OE",
};

const COMPARISON: Readonly<Record<string, string>> = {
  å: "a",
  ä: "a",
  ö: "o",
  Å: "a",
  Ä: "a",
  Ö: "o",
};

export const swedishUmlauts: VariationPlugin = {
  id: "swedish-umlauts",
  language: "sv",
  nameKey: "plugins.swedishUmlauts.name",
  descriptionKey: "plugins.swedishUmlauts.description",
  defaultEnabled: false,
  variationMaps: [SINGLE_LETTER, DIGRAPH],
  comparisonMap: COMPARISON,
  // Swedish articles ("en/ett/den/det") are typically not stripped from
  // release titles, so we leave the article list empty.
  wordChars: "åÅäÄöÖ",
};
