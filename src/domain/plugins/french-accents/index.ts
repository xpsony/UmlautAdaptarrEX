import type { VariationPlugin } from "../types";

// French accented vowels are conventionally written without the diacritic in
// release titles (é → e, à → a, …). Ligatures (æ, œ) are expanded to ae/oe.
//   1. "Stripped":  drops every diacritic and expands ligatures.
//   2. "Ligatures only": keeps accents but still expands æ/œ - this is the
//      form used when filenames are produced on locales that allow accents
//      but lack ligature support.
const STRIPPED: Readonly<Record<string, string>> = {
  à: "a",
  â: "a",
  ä: "a",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  î: "i",
  ï: "i",
  ô: "o",
  ö: "o",
  ù: "u",
  û: "u",
  ü: "u",
  ÿ: "y",
  ç: "c",
  æ: "ae",
  œ: "oe",
  À: "A",
  Â: "A",
  Ä: "A",
  É: "E",
  È: "E",
  Ê: "E",
  Ë: "E",
  Î: "I",
  Ï: "I",
  Ô: "O",
  Ö: "O",
  Ù: "U",
  Û: "U",
  Ü: "U",
  Ÿ: "Y",
  Ç: "C",
  Æ: "AE",
  Œ: "OE",
};

const LIGATURES_ONLY: Readonly<Record<string, string>> = {
  æ: "ae",
  œ: "oe",
  Æ: "AE",
  Œ: "OE",
};

const COMPARISON: Readonly<Record<string, string>> = {
  à: "a",
  â: "a",
  ä: "a",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  î: "i",
  ï: "i",
  ô: "o",
  ö: "o",
  ù: "u",
  û: "u",
  ü: "u",
  ÿ: "y",
  ç: "c",
  æ: "ae",
  œ: "oe",
  À: "a",
  Â: "a",
  Ä: "a",
  É: "e",
  È: "e",
  Ê: "e",
  Ë: "e",
  Î: "i",
  Ï: "i",
  Ô: "o",
  Ö: "o",
  Ù: "u",
  Û: "u",
  Ü: "u",
  Ÿ: "y",
  Ç: "c",
  Æ: "ae",
  Œ: "oe",
};

export const frenchAccents: VariationPlugin = {
  id: "french-accents",
  language: "fr",
  nameKey: "plugins.frenchAccents.name",
  descriptionKey: "plugins.frenchAccents.description",
  defaultEnabled: false,
  variationMaps: [STRIPPED, LIGATURES_ONLY],
  comparisonMap: COMPARISON,
  // Standard French definite/indefinite/partitive articles. "L'" is omitted
  // because the article-stripping regex requires a trailing space and the
  // elided form attaches directly to the next word.
  articles: ["Le", "La", "Les", "Un", "Une", "Des", "Du", "De"],
  wordChars: "àâäéèêëîïôöùûüÿçæœÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇÆŒ",
};
