import { normalizeForComparison, normalizedCharContribution } from "../normalization/comparison";
import { getActiveLanguagePack, type LanguagePack } from "../plugins";
import { escapeRegex, findFirstSeparator } from "./separator";

export interface RenameSearchItem {
  expectedTitle: string;
  titleMatchVariations: string[];
  /**
   * Release year for movies (and TV first-air year). When present and the
   * release title carries a 4-digit year outside the tolerance window, the
   * rewrite is refused. Disambiguates franchise overlap such as a Formula 1
   * race recording vs. the 2025 "F1 - Der Film".
   */
  year?: number | null;
  /**
   * Tolerance window in years around `year`. `null` disables the check
   * entirely (year-matching off). A non-negative integer accepts release-
   * name years within +/-N. Default is 1 year, which absorbs common
   * production-vs-release-year skew without losing disambiguation power.
   */
  yearMatchingTolerance?: number | null;
}

const DEFAULT_YEAR_TOLERANCE = 1;

/**
 * Operator-configurable rename behaviour (Settings -> Renaming). Every flag
 * defaults to today's EX behaviour, so an omitted option object behaves
 * exactly like before this was configurable.
 */
export interface RenameOptions {
  /**
   * Refuse the rewrite when the release name carries a 4-digit year outside
   * the item's tolerance window. `false` skips the check regardless of
   * `yearMatchingTolerance` - the .NET predecessor had no year check at all.
   */
  yearGuard?: boolean;
  /**
   * Refuse the rewrite when `expectedTitle` itself starts with the matched
   * variation and no strong release marker (SxxExx / a 4-digit year) follows.
   * Guards against a short alias hijacking a different work that merely
   * shares the prefix.
   */
  prefixGuard?: boolean;
  /**
   * Push a release-format tag (3D/4K/HDR/IMAX) that a provider alias baked
   * into its string back into the suffix instead of swallowing it.
   */
  releaseTagGuard?: boolean;
  /**
   * Cut the suffix at the matched variation's RAW length, the way the .NET
   * predecessor did, instead of counting normalized characters. Reproduces
   * the predecessor's off-by-N on expanding characters (German ß -> "ss")
   * and on accents outside the active plugins, so it is opt-in only.
   */
  legacySuffix?: boolean;
  /**
   * Strip characters that are unwelcome in release names from the inserted
   * title (see `stripReleaseUnsafeChars`). Only the *inserted* title is
   * touched; the indexer's own suffix is passed through verbatim.
   */
  stripSpecialChars?: boolean;
}

const DEFAULT_RENAME_OPTIONS: Required<RenameOptions> = {
  yearGuard: true,
  prefixGuard: true,
  releaseTagGuard: true,
  legacySuffix: false,
  stripSpecialChars: false,
};

// Characters that never appear in a scene release name and that Sonarr,
// Radarr and most filesystems dislike. `:` is the one that actually shows up
// in practice, via expectedTitles of the form "Subtitle: After the Colon".
const RELEASE_UNSAFE_CHARS_RE = /[:?*"<>|/\\]/g;

/**
 * Remove release-unsafe characters from a title and tidy up what that leaves
 * behind. Stripping `:` out of "Ember:.Steel.Angel" would otherwise emit a
 * doubled separator ("Ember..Steel.Angel"), so runs of `.`, `_` and spaces
 * are collapsed and any now-dangling separator is trimmed off the ends.
 */
export function stripReleaseUnsafeChars(title: string): string {
  return title
    .replace(RELEASE_UNSAFE_CHARS_RE, "")
    .replace(/\.{2,}/g, ".")
    .replace(/_{2,}/g, "_")
    .replace(/ {2,}/g, " ")
    .replace(/^[._ -]+|[._ -]+$/g, "");
}

export interface RenameResult {
  rewrittenTitle: string | null;
  reason?:
    | "match-equals-expected"
    | "ambiguous-prefix"
    | "token-continuation"
    | "year-mismatch"
    | "no-match";
}

const ALPHANUMERIC_RE = /[A-Za-z0-9]/;
// Closing delimiters that can trail a matched title inside a release name.
// Opening counterparts are excluded on purpose - see the skip loop below.
const CLOSING_DELIM_RE = /[)\]}]/;
const YEAR_TOKEN_RE = /(?<![A-Za-z0-9])(19|20)\d{2}(?![A-Za-z0-9])/g;
// Release-format tags that title providers occasionally bake into alias
// strings (TMDB/TVDB return e.g. "Galaxy Wars Reckoning 3D"). When such
// a variation matches the original, the trailing tag belongs to the
// release name, not the title, and must stay in the suffix during rewrite.
const RELEASE_TAG_TAIL_RE = /([\s._-])(3D|4K|HDR|IMAX)$/i;
// Everything that carries no title identity: separators, punctuation,
// brackets. Release names spell one and the same title with wildly different
// punctuation ("Ember.Steel.Angel" vs "Ember: Steel Angel").
const NON_IDENTITY_CHAR_RE = /[^\p{L}\p{N}]/gu;
// A letter in ANY script.
const LETTER_RE = /\p{L}/u;

/**
 * Identity of a release name for no-op detection: letters and digits only,
 * lower-cased.
 *
 * Deliberately NOT `normalizeForComparison`: its comparison map folds
 * diacritics onto the base letter (German "ä" -> "a", "ß" -> "ss"), and
 * restoring exactly those characters is this product's core job. A fold that
 * erases them would declare every umlaut rewrite a no-op.
 */
function releaseIdentity(title: string): string {
  return title.replace(NON_IDENTITY_CHAR_RE, "").toLowerCase();
}

function releaseYears(title: string): number[] {
  const years: number[] = [];
  for (const match of title.matchAll(YEAR_TOKEN_RE)) {
    years.push(Number(match[0]));
  }
  return years;
}

export function renameForMoviesAndTv(
  originalTitle: string,
  searchItem: RenameSearchItem,
  pack: LanguagePack = getActiveLanguagePack(),
  options: RenameOptions = {},
): RenameResult {
  const opts = { ...DEFAULT_RENAME_OPTIONS, ...options };
  const normalizedOriginal = normalizeForComparison(originalTitle, pack);
  const variations = [...searchItem.titleMatchVariations].sort(
    (a, b) => normalizeForComparison(b, pack).length - normalizeForComparison(a, pack).length,
  );

  // Year disambiguation: if the search item knows its release year and the
  // caller wants the year check (`yearMatchingTolerance` is a number, not
  // null), the release title's 4-digit year token must lie within +/-N of
  // the item's year. `yearMatchingTolerance === null` disables the check
  // entirely so per-instance opt-out works without dropping the year value
  // itself. Defaulting to 1 absorbs production-vs-release-year skew.
  const tolerance =
    searchItem.yearMatchingTolerance === undefined
      ? DEFAULT_YEAR_TOLERANCE
      : searchItem.yearMatchingTolerance;
  if (opts.yearGuard && searchItem.year != null && tolerance !== null) {
    const years = releaseYears(originalTitle);
    if (years.length > 0) {
      const itemYear = searchItem.year;
      const inTolerance = years.some((y) => Math.abs(y - itemYear) <= tolerance);
      if (!inTolerance) {
        return { rewrittenTitle: null, reason: "year-mismatch" };
      }
    }
  }

  // A work whose title carries no letter at all (e.g. "7-1-3") is the only
  // one allowed to match on a letter-less variation - see the residue guard
  // in the loop.
  const expectedHasLetters = LETTER_RE.test(searchItem.expectedTitle);

  for (const variation of variations) {
    if (variation === searchItem.expectedTitle) continue;

    // A variation without a single letter is not a title, it is the residue
    // `getCleanTitle` left of a non-Latin alias: a numbered sequel alias such
    // as "<non-Latin title> 3" collapses to the bare "3". As a prefix match
    // that numeral turns every unrelated release starting with "3." into a
    // rewrite candidate, so it is only usable when the work itself has no
    // letters to lose.
    if (expectedHasLetters && !LETTER_RE.test(variation)) continue;

    const normalizedVariation = normalizeForComparison(variation, pack);
    if (!normalizedVariation) continue;
    if (!normalizedOriginal.startsWith(normalizedVariation)) continue;

    const separator = findFirstSeparator(originalTitle);
    // Strip release-unsafe characters BEFORE the space->separator swap, then
    // once more after: "Ember: Steel Angel" with separator "." becomes
    // "Ember:.Steel.Angel" -> "Ember..Steel.Angel", and only the second
    // pass collapses that doubled separator.
    const expectedForPrefix = opts.stripSpecialChars
      ? stripReleaseUnsafeChars(searchItem.expectedTitle)
      : searchItem.expectedTitle;
    let newTitlePrefix = expectedForPrefix.replace(/ /g, separator);
    if (opts.stripSpecialChars) {
      newTitlePrefix = stripReleaseUnsafeChars(newTitlePrefix);
    }

    // Walk originalTitle counting how many *normalized* chars each char
    // contributes. Comparison-map entries can expand 1→N (e.g. German ß →
    // "ss") and accents not covered by an active plugin still normalize to
    // a base letter (é → "e"); a raw word-char count would slice the
    // suffix wrong by N per char, eating the next token (e.g. variation
    // "Strasse" against "Straße.Test.S01E01" would return ".est.S01E01"
    // and "Cafe" against "Café.S01E01" would return "01E01").
    let endIdx: number;
    if (opts.legacySuffix) {
      // Predecessor behaviour: cut at the variation's raw length. Wrong
      // whenever a character expands or folds during normalization, which is
      // exactly why the counted walk below exists - kept only for operators
      // who want the old output byte for byte.
      endIdx = Math.min(variation.length, originalTitle.length);
    } else {
      const targetCount = normalizedVariation.length;
      let matchedNormalized = 0;
      endIdx = 0;
      for (let i = 0; i < originalTitle.length; i++) {
        const c = originalTitle[i]!;
        matchedNormalized += normalizedCharContribution(c, pack);
        endIdx = i + 1;
        if (matchedNormalized >= targetCount) break;
      }
    }

    // When the variation matched without trailing punctuation (e.g. variation
    // "Chronicles of Time 2005" against original "Chronicles of Time (2005) -
    // S08E08..."), targetCount is reached on the last alphanumeric character
    // ('5'), leaving the ')' unconsumed - it would leak into the suffix and the
    // rewrite would emit "Chronicles.of.Time.(2005).).S08E08...". Advance
    // endIdx over it.
    //
    // Deliberately limited to *closing* delimiters: consuming an opening one
    // would swallow the start of the suffix in "Chronicles of Time(2005)..."
    // and land the token-boundary check below on '2', discarding a valid match.
    while (endIdx < originalTitle.length && CLOSING_DELIM_RE.test(originalTitle[endIdx]!)) {
      endIdx++;
    }

    // Token-boundary check: a normalized prefix-match isn't enough; the
    // variation must end on a real token boundary in the *original* string.
    // Otherwise variation "Mike Renko 2" (norm "mikerenko2") matches the
    // start of "Mike.Renko.2016.German.DL..." (norm "mikerenko2016...")
    // and the rewrite eats the leading "2" of the year, producing
    // "Die.Renko.Jagd.016.German.DL...". Any non-alphanumeric
    // (`.`, `-`, ` `, `_`, …) or end-of-string is a clean boundary.
    //
    // Skipped under `legacySuffix`: the raw-length cut above does not land on
    // the true end of the match, so this check would be reading the wrong
    // position and would turn the toggle into "declines renames at random"
    // instead of reproducing the predecessor (which had no boundary check
    // either). Both halves belong to the same optimisation.
    if (!opts.legacySuffix) {
      const nextChar = originalTitle[endIdx];
      if (nextChar !== undefined && ALPHANUMERIC_RE.test(nextChar)) {
        continue;
      }
    }

    // If the consumed prefix ends with a release-format tag (3D/4K/HDR/
    // IMAX) at a token boundary, and the expectedTitle itself doesn't
    // carry that tag, push the tag back into the suffix. Otherwise an
    // alias like "Resident Evil: Afterlife 3D" eats the "3D" of
    // "Resident.Evil.Afterlife.3D.2010..." and the rewrite drops it.
    const tagMatch = opts.releaseTagGuard
      ? RELEASE_TAG_TAIL_RE.exec(originalTitle.slice(0, endIdx))
      : null;
    if (tagMatch) {
      const tag = tagMatch[2]!;
      const tagInExpectedRe = new RegExp(`(?:^|[^A-Za-z0-9])${tag}(?:$|[^A-Za-z0-9])`, "i");
      if (!tagInExpectedRe.test(searchItem.expectedTitle)) {
        endIdx -= tag.length + 1;
      }
    }

    let suffix = originalTitle.slice(endIdx);

    // When expectedTitle starts with the variation (e.g. "Sigrid"), only
    // rewrite if a strong release-marker follows directly - SxxExx for TV,
    // a 4-digit year for movies. Otherwise the prefix is ambiguous (could
    // be a different work that just shares the prefix).
    if (
      opts.prefixGuard &&
      searchItem.expectedTitle.toLowerCase().startsWith(variation.toLowerCase())
    ) {
      const sep = escapeRegex(separator);
      const markerRe = new RegExp(`^${sep}(?:S\\d{1,4}E\\d{1,4}|(?:19|20)\\d{2}(?:${sep}|$))`);
      if (!markerRe.test(suffix)) {
        return { rewrittenTitle: null, reason: "ambiguous-prefix" };
      }
    }

    suffix = suffix.replace(/^ +/, "");

    let newTitle: string;
    if (!suffix) {
      newTitle = newTitlePrefix;
    } else if (suffix.startsWith(separator)) {
      newTitle = newTitlePrefix + suffix;
    } else {
      newTitle = `${newTitlePrefix}${separator}${suffix}`;
    }

    // A rewrite that changes nothing but punctuation is no rewrite at all.
    // Happens when no separate German title exists, so the provider hands
    // back the expectedTitle itself: the variation generator drops its
    // brackets, which makes the variation a different *string* naming the
    // very same title, and inserting expectedTitle verbatim pushes "(", ")"
    // or ":" back into a scene name that already spelled the title right.
    if (releaseIdentity(newTitle) === releaseIdentity(originalTitle)) {
      return { rewrittenTitle: null, reason: "match-equals-expected" };
    }

    return { rewrittenTitle: newTitle };
  }

  return { rewrittenTitle: null, reason: "no-match" };
}
