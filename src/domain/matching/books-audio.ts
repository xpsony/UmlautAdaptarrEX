import {
  normalizeForComparison,
  normalizedCharContribution,
} from "../normalization/comparison";
import { getActiveLanguagePack, type LanguagePack } from "../plugins";

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

// Pick the single most specific variation from `variations` rather than
// merging spans across multiple matches: a stray short variation that
// happens to appear late in the release name would otherwise pull
// `endOriginal` past the real author/title region and eat the trailing
// quality tags. We prefer the longest normalized match; ties go to the
// earliest start.
function findBestMatch(
  variations: string[],
  originalTitle: string,
  normalizedOriginal: string,
  pack: LanguagePack,
): MatchSpan {
  let bestNormLen = -1;
  let bestStartNorm = -1;
  let bestEndNorm = -1;

  for (const variation of variations) {
    const normVar = normalizeForComparison(variation, pack);
    if (!normVar) continue;
    const startNorm = normalizedOriginal.indexOf(normVar);
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

  if (bestNormLen < 0)
    return { found: false, startOriginal: 0, endOriginal: 0 };

  const startOrig = mapNormalizedIndexToOriginal(
    originalTitle,
    bestStartNorm,
    pack,
  );
  const endOrig = mapNormalizedIndexToOriginal(
    originalTitle,
    bestEndNorm,
    pack,
  );
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

export function renameForBooksAndAudio(
  originalTitle: string,
  searchItem: BooksAudioSearchItem,
  pack: LanguagePack = getActiveLanguagePack(),
): BooksAudioRenameResult {
  const normalized = normalizeForComparison(originalTitle, pack);
  const author = findBestMatch(
    searchItem.authorMatchVariations,
    originalTitle,
    normalized,
    pack,
  );
  const title = findBestMatch(
    searchItem.titleMatchVariations,
    originalTitle,
    normalized,
    pack,
  );

  if (!author.found || !title.found) return { rewrittenTitle: null };

  let endPos = Math.max(author.endOriginal, title.endOriginal);
  while (
    endPos < originalTitle.length &&
    !/[A-Za-z0-9]/.test(originalTitle[endPos]!) &&
    !TRAILING_DELIMS.includes(originalTitle[endPos]!)
  ) {
    endPos++;
  }
  if (
    endPos < originalTitle.length &&
    TRAILING_DELIMS.includes(originalTitle[endPos]!)
  ) {
    endPos++;
  }

  let suffix = originalTitle.slice(endPos);
  while (suffix.length && TRAILING_DELIMS.includes(suffix[0]!))
    suffix = suffix.slice(1);
  suffix = suffix.trim();

  let updated = `${searchItem.expectedAuthor} - ${searchItem.expectedTitle}`;
  if (suffix.length >= 3) {
    updated += `-[${suffix}]`;
  }
  return { rewrittenTitle: updated };
}
