import { normalizeForComparison, normalizedCharContribution } from "../normalization/comparison";
import { getActiveLanguagePack, type LanguagePack } from "../plugins";
import { stripReleaseUnsafeChars } from "./rename";

export interface BooksAudioSearchItem {
  expectedTitle: string;
  expectedAuthor: string;
  titleMatchVariations: string[];
  authorMatchVariations: string[];
}

export interface BooksAudioRenameResult {
  rewrittenTitle: string | null;
}

interface MatchSpan {
  found: boolean;
  startOriginal: number;
  endOriginal: number;
}

/** A span of the normalized release title. */
interface NormSpan {
  start: number;
  end: number;
}

// Every occurrence of every variation in the normalized title.
function findAllSpans(
  variations: string[],
  normalizedOriginal: string,
  pack: LanguagePack,
): NormSpan[] {
  const spans: NormSpan[] = [];
  for (const variation of variations) {
    const normVar = normalizeForComparison(variation, pack);
    if (!normVar) continue;
    for (
      let i = normalizedOriginal.indexOf(normVar);
      i >= 0;
      i = normalizedOriginal.indexOf(normVar, i + 1)
    ) {
      spans.push({ start: i, end: i + normVar.length });
    }
  }
  return spans;
}

// Whether `start..start+length` lies entirely within a LONGER span of
// `exclude`. Only containment counts: a title that merely starts with the
// author's name ("Kissin' Time" by Kiss) is still found. A span of the same
// length is no reason to skip: "Specials" by The Specials is also an author
// variation, and the album itself must still be found.
function isWithinLongerSpan(start: number, length: number, exclude: NormSpan[]): boolean {
  return exclude.some(
    (span) => start >= span.start && start + length <= span.end && span.end - span.start > length,
  );
}

const COMBINING_MARK = /\p{M}/u;

// A character that survives normalizeForComparison, i.e. a letter or digit.
// A separate combining mark (decomposed "u" + U+0308) belongs to the letter
// in front of it, so it counts as part of the word as well.
function isWordChar(c: string | undefined, pack: LanguagePack): boolean {
  return c !== undefined && (normalizedCharContribution(c, pack) > 0 || COMBINING_MARK.test(c));
}

// Whether the normalized span covers whole words of the original title: no
// letter or digit directly before or after it. Without this check "Usher" is
// found in "Hayley And The Crushers" and "Rage" in "Outrageous", and those
// releases are renamed to an album of that artist.
//
// The span must also start and end on a whole original character. One
// character can normalize to several (German ß -> "ss"); a match that begins
// or ends inside such a character is part of that word, even when a
// separator follows it ("sonne" in "Heiß Onne", "gros" in "Groß Stadt").
function isWholeWords(
  originalTitle: string,
  startNorm: number,
  endNorm: number,
  pack: LanguagePack,
): boolean {
  let count = 0;
  let start = -1;
  for (let i = 0; i < originalTitle.length; i++) {
    const width = normalizedCharContribution(originalTitle[i]!, pack);
    if (width === 0) continue;
    if (start < 0 && count + width > startNorm) {
      if (count !== startNorm) return false;
      start = i;
    }
    count += width;
    if (count >= endNorm) {
      if (count !== endNorm) return false;
      // Marks right after the last letter still belong to it ("Cafe" + U+0301).
      let next = i + 1;
      while (next < originalTitle.length && COMBINING_MARK.test(originalTitle[next]!)) next++;
      return !isWordChar(originalTitle[start - 1], pack) && !isWordChar(originalTitle[next], pack);
    }
  }
  return false;
}

// First occurrence of `needle` that is made of whole words and does not lie
// within a longer span of `exclude`, or -1.
function indexOfMatch(
  normalizedOriginal: string,
  needle: string,
  originalTitle: string,
  pack: LanguagePack,
  exclude: NormSpan[],
): number {
  let start = normalizedOriginal.indexOf(needle);
  while (
    start >= 0 &&
    (isWithinLongerSpan(start, needle.length, exclude) ||
      !isWholeWords(originalTitle, start, start + needle.length, pack))
  ) {
    start = normalizedOriginal.indexOf(needle, start + 1);
  }
  return start;
}

// Pick the single most specific variation from `variations` rather than
// merging spans across multiple matches: a stray short variation that
// happens to appear late in the release name would otherwise pull
// `endOriginal` past the real author/title region and eat the trailing
// quality tags. We prefer the longest normalized match; ties go to the
// earliest start. Only whole words count, and occurrences inside a longer
// span of `exclude` are skipped.
function findBestMatch(
  variations: string[],
  originalTitle: string,
  normalizedOriginal: string,
  pack: LanguagePack,
  exclude: NormSpan[] = [],
): MatchSpan {
  let bestNormLen = -1;
  let bestStartNorm = -1;
  let bestEndNorm = -1;

  for (const variation of variations) {
    const normVar = normalizeForComparison(variation, pack);
    if (!normVar) continue;
    const startNorm = indexOfMatch(normalizedOriginal, normVar, originalTitle, pack, exclude);
    if (startNorm < 0) continue;
    if (
      normVar.length > bestNormLen ||
      (normVar.length === bestNormLen && startNorm < bestStartNorm)
    ) {
      bestNormLen = normVar.length;
      bestStartNorm = startNorm;
      bestEndNorm = startNorm + normVar.length;
    }
  }

  if (bestNormLen < 0) return { found: false, startOriginal: 0, endOriginal: 0 };

  const startOrig = mapNormalizedIndexToOriginal(originalTitle, bestStartNorm, pack);
  let endOrig = mapNormalizedIndexToOriginal(originalTitle, bestEndNorm, pack);
  // A separate combining mark after the last letter belongs to the match, not
  // to the [suffix] ("Cafe" + U+0301).
  while (endOrig < originalTitle.length && COMBINING_MARK.test(originalTitle[endOrig]!)) endOrig++;
  return { found: true, startOriginal: startOrig, endOriginal: endOrig };
}

function mapNormalizedIndexToOriginal(
  originalTitle: string,
  normalizedIndex: number,
  pack: LanguagePack,
): number {
  // Counts in *normalized* chars: comparison-map entries can expand 1→N
  // (German ß → "ss") and unmapped accents still normalize to a base
  // letter (é → "e") even when no active plugin lists them as wordChars.
  // A raw word-char count would overshoot/undershoot per such char and eat
  // the next token of the suffix.
  let normalizedCount = 0;
  let lastIdx = 0;
  for (let i = 0; i < originalTitle.length; i++) {
    if (normalizedCount >= normalizedIndex) return i;
    normalizedCount += normalizedCharContribution(originalTitle[i]!, pack);
    lastIdx = i + 1;
  }
  return lastIdx;
}

const TRAILING_DELIMS = [" ", "-", "_", "."];
const CLOSING_DELIMS = [")", "]", "}"];

export interface BooksAudioRenameOptions {
  /**
   * Strip release-unsafe characters (`: ? * " < > | / \`) from the inserted
   * author/title. Mirrors the movie/TV option; the `[suffix]` block keeps the
   * indexer's own text verbatim.
   */
  stripSpecialChars?: boolean;
}

export function renameForBooksAndAudio(
  originalTitle: string,
  searchItem: BooksAudioSearchItem,
  pack: LanguagePack = getActiveLanguagePack(),
  options: BooksAudioRenameOptions = {},
): BooksAudioRenameResult {
  const normalized = normalizeForComparison(originalTitle, pack);
  const author = findBestMatch(searchItem.authorMatchVariations, originalTitle, normalized, pack);
  if (!author.found) return { rewrittenTitle: null };
  // The title must not be found inside the author's name: album "Michael"
  // by Michael Jackson would otherwise match in every release of the artist,
  // and the real album would end up in the [suffix]. Every occurrence of the
  // name counts, so "Alicia Keys - Alicia Keys - Unplugged" does not become
  // album "ALICIA" either. A self-titled release ("Michael Jackson - Michael
  // (2010)") still matches - its title also appears on its own.
  const authorSpans = findAllSpans(searchItem.authorMatchVariations, normalized, pack);
  const title = findBestMatch(
    searchItem.titleMatchVariations,
    originalTitle,
    normalized,
    pack,
    authorSpans,
  );
  if (!title.found) return { rewrittenTitle: null };

  let endPos = Math.max(author.endOriginal, title.endOriginal);
  // A variation without parentheses ends its span on the last alphanumeric
  // ('5' in "Deep Water (2005)"), leaving the ')' to leak into the suffix.
  // Skip closing delimiters only - consuming an opening one would strip the
  // "[" that starts the quality tag in "Deep Water[MP3-128kbps]".
  while (endPos < originalTitle.length && CLOSING_DELIMS.includes(originalTitle[endPos]!)) {
    endPos++;
  }
  if (endPos < originalTitle.length && TRAILING_DELIMS.includes(originalTitle[endPos]!)) {
    endPos++;
  }

  let suffix = originalTitle.slice(endPos);
  while (suffix.length && TRAILING_DELIMS.includes(suffix[0]!)) suffix = suffix.slice(1);
  suffix = suffix.trim();

  const outAuthor = options.stripSpecialChars
    ? stripReleaseUnsafeChars(searchItem.expectedAuthor)
    : searchItem.expectedAuthor;
  const outTitle = options.stripSpecialChars
    ? stripReleaseUnsafeChars(searchItem.expectedTitle)
    : searchItem.expectedTitle;
  let updated = `${outAuthor} - ${outTitle}`;
  if (suffix.length >= 3) {
    updated += `-[${suffix}]`;
  }
  return { rewrittenTitle: updated };
}
