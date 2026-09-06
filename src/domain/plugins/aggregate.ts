import { escapeRegex } from "../matching/separator";
import type { VariationPlugin } from "./types";

export interface LanguagePack {
  /**
   * Plugins aggregated into this pack, in the order they were passed in.
   * Required by the multi-language variations path so that each plugin can
   * pull its matching language title (`plugin.language` ->
   * `titlesByLang[plugin.language]`). The existing hot-path fields
   * (`variationMaps` etc.) are unchanged.
   */
  activePlugins: ReadonlyArray<VariationPlugin>;
  /** Concatenated `variationMaps` from all active plugins. */
  variationMaps: ReadonlyArray<Readonly<Record<string, string>>>;
  /** Concatenated audio/book-only maps. */
  audioOnlyMaps: ReadonlyArray<Readonly<Record<string, string>>>;
  /** Merged comparison map (later plugins overwrite earlier on key collision). */
  comparisonMap: Readonly<Record<string, string>>;
  /** Deduped union of all plugin article lists. */
  articles: ReadonlyArray<string>;
  /** Regex-ready chars (already escaped, deduped) to extend `[a-z0-9…]`. */
  wordCharsEscaped: string;
  /**
   * Combining marks (U+0300–U+036F) that should be preserved during NFD
   * stripping. Derived from the union of plugin `wordChars` decomposed via
   * NFD: e.g. `Ä` → `A` + COMBINING DIAERESIS (U+0308) registers U+0308.
   */
  combiningMarksToKeep: ReadonlySet<string>;
  /** Whether the aggregate has any active plugin (false → identity-only pack). */
  hasPlugins: boolean;

  // ── Hot-path precomputed regexes (built once per pack) ─────────────────────
  /** `[a-z0-9…]/i` - used by rename/matching to count "word characters". */
  wordCharRegex: RegExp;
  /** `^(Der|Die|…) ` - null when no plugin contributes articles. */
  articleRegex: RegExp | null;
  /** `[^a-zA-Z0-9 …\-]+/g` - strips specials but keeps plugin word chars. */
  specialCharsKeepRegex: RegExp;
}

export function aggregatePlugins(
  active: readonly VariationPlugin[],
): LanguagePack {
  const variationMaps: Array<Readonly<Record<string, string>>> = [];
  const audioOnlyMaps: Array<Readonly<Record<string, string>>> = [];
  const comparisonMap: Record<string, string> = {};
  const articleSet = new Set<string>();
  const wordCharsSet = new Set<string>();

  for (const plugin of active) {
    for (const m of plugin.variationMaps) variationMaps.push(m);
    if (plugin.audioOnlyMaps) {
      for (const m of plugin.audioOnlyMaps) audioOnlyMaps.push(m);
    }
    Object.assign(comparisonMap, plugin.comparisonMap);
    if (plugin.articles) {
      for (const a of plugin.articles) articleSet.add(a);
    }
    if (plugin.wordChars) {
      for (const ch of plugin.wordChars) wordCharsSet.add(ch);
    }
  }

  const combiningMarksToKeep = new Set<string>();
  for (const ch of wordCharsSet) {
    for (const part of ch.normalize("NFD")) {
      const code = part.charCodeAt(0);
      if (code >= 0x0300 && code <= 0x036f) combiningMarksToKeep.add(part);
    }
  }

  const wordCharsEscaped = escapeRegex(Array.from(wordCharsSet).join(""));
  const wordCharRegex = wordCharsEscaped
    ? new RegExp(`[a-z0-9${wordCharsEscaped}]`, "i")
    : /[a-z0-9]/i;
  const articles = Array.from(articleSet);
  // Case-insensitive: lowercase ("die hütte") and all-caps ("DIE HÜTTE")
  // titles must get their leading article stripped too, matching
  // `stripLeadingArticle` which also uses the `i` flag.
  const articleRegex =
    articles.length > 0
      ? new RegExp(`^(${articles.map(escapeRegex).join("|")}) `, "i")
      : null;
  const specialCharsKeepRegex = new RegExp(
    `[^a-zA-Z0-9 ${wordCharsEscaped}\\-]+`,
    "g",
  );

  return {
    activePlugins: active,
    variationMaps,
    audioOnlyMaps,
    comparisonMap,
    articles,
    wordCharsEscaped,
    combiningMarksToKeep,
    hasPlugins: active.length > 0,
    wordCharRegex,
    articleRegex,
    specialCharsKeepRegex,
  };
}

// ── Char-map fast path ───────────────────────────────────────────────────────
//
// `applyCharMap` and `hasMappedChar` get hammered: every variation, every
// release-title comparison hits them. The naive loop visits every codepoint
// even for plain ASCII strings ("Some.Show.Title") where no key matches -
// roughly the steady-state release name. We precompile a regex per map
// (cached on the map's identity) and bail out in O(1) when no key is present.

interface MapRegex {
  /** Single-shot detect (no flags) - used for fast bail. */
  detect: RegExp;
  /** Global replace, used for actual substitution. */
  replace: RegExp;
}

const mapRegexCache = new WeakMap<
  Readonly<Record<string, string>>,
  MapRegex | null
>();

function getMapRegex(map: Readonly<Record<string, string>>): MapRegex | null {
  if (mapRegexCache.has(map)) {
    return mapRegexCache.get(map) ?? null;
  }
  const keys = Object.keys(map);
  if (keys.length === 0) {
    mapRegexCache.set(map, null);
    return null;
  }
  // Plugin maps use single-codepoint keys; a character class is the cheapest
  // form of alternation.
  const cls = `[${keys.map(escapeRegex).join("")}]`;
  const entry: MapRegex = {
    detect: new RegExp(cls),
    replace: new RegExp(cls, "g"),
  };
  mapRegexCache.set(map, entry);
  return entry;
}

/** Apply all substitutions in `map` to `input`. Single-char keys assumed. */
export function applyCharMap(
  input: string,
  map: Readonly<Record<string, string>>,
): string {
  if (!input) return input;
  const re = getMapRegex(map);
  if (!re || !re.detect.test(input)) return input;
  return input.replace(re.replace, (ch) => map[ch] ?? ch);
}

/** True if any character in `input` has a substitution in `map`. */
export function hasMappedChar(
  input: string,
  map: Readonly<Record<string, string>>,
): boolean {
  if (!input) return false;
  const re = getMapRegex(map);
  if (!re) return false;
  return re.detect.test(input);
}
