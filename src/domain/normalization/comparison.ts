import {
  applyCharMap,
  getActiveLanguagePack,
  type LanguagePack,
} from "../plugins";
import { removeAccent } from "./accents";

const NON_ASCII_RE = /[-￿]/;
const SPECIAL_NO_DIACRITICS = /[^a-zA-Z0-9 \-]+/g;
const WS_DASH_RE = /[\s\-]+/g;

export function normalizeForComparison(
  input: string,
  pack: LanguagePack = getActiveLanguagePack(),
): string {
  // Fast path: most release titles are plain ASCII (e.g. "Some.Show.S01E01").
  // Skip char-map + NFD entirely.
  if (!NON_ASCII_RE.test(input)) {
    return input
      .replace(SPECIAL_NO_DIACRITICS, "")
      .replace(WS_DASH_RE, "")
      .toLowerCase();
  }
  let s = applyCharMap(input, pack.comparisonMap);
  s = removeAccent(s);
  s = s.replace(SPECIAL_NO_DIACRITICS, "");
  s = s.replace(WS_DASH_RE, "");
  return s.toLowerCase();
}

/**
 * How many characters this single char contributes to its
 * `normalizeForComparison` form. ASCII alphanumerics = 1, ASCII separators
 * = 0; non-ASCII goes through the full pipeline so that accents like `é`
 * still count as 1 even when no active plugin lists them in `wordChars`,
 * and so that 1→N expansions (German `ß` → "ss") are credited correctly.
 *
 * The matching walk uses this to map a position in the normalized string
 * back to a position in the original - getting the contribution wrong by N
 * eats N characters of the suffix.
 */
export function normalizedCharContribution(
  c: string,
  pack: LanguagePack = getActiveLanguagePack(),
): number {
  const code = c.charCodeAt(0);
  if (code < 0x80) {
    if (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      return 1;
    }
    return 0;
  }
  return normalizeForComparison(c, pack).length;
}
