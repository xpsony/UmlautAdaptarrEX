import { removeExtraWhitespaces } from "../normalization/clean";
import {
  aggregatePlugins,
  getActiveLanguagePack,
  type LanguagePack,
} from "../plugins";
import { generateVariations, type MediaType } from "./generate";

const YEAR_AT_END_RE = /\((\d{4})\)$/;

export interface TvMovieVariationInput {
  /**
   * Legacy single-title input: was historically the German title only. Kept
   * for backward compatibility and varied against the full LanguagePack
   * (default plugin = `german-umlauts`). If `titlesByLang.de` is set, that
   * value wins.
   */
  germanTitle: string | null | undefined;
  /**
   * Per-language titles. When a language plugin is active, the title for
   * that language is run through the plugin's own variation maps (Swedish
   * plugin -> titlesByLang.sv, etc.). Languages without an active plugin or
   * without a title are ignored.
   */
  titlesByLang?: Record<string, string> | null | undefined;
  expectedTitle: string;
  aliases: string[] | null | undefined;
  mediaType: Extract<MediaType, "tv" | "movie">;
}

export interface TvMovieVariationOutput {
  titleSearchVariations: string[];
  titleMatchVariations: string[];
  authorMatchVariations: string[];
  aliases: string[] | null;
  germanTitle: string | null;
}

export function generateForTvMovie(
  input: TvMovieVariationInput,
  pack: LanguagePack = getActiveLanguagePack(),
): TvMovieVariationOutput {
  // titlesByLang.de takes precedence over the legacy param. If both are
  // set and conflict, the older path would otherwise see stale data.
  const inputDe = input.titlesByLang?.de ?? null;
  let germanTitle = inputDe ?? input.germanTitle ?? null;
  let aliases = input.aliases ? [...input.aliases] : null;

  const yearMatch = YEAR_AT_END_RE.exec(input.expectedTitle);
  if (yearMatch) {
    const year = yearMatch[1]!;
    if (germanTitle && !germanTitle.includes(year)) {
      germanTitle = `${germanTitle} ${year}`;
    }
    if (aliases) {
      aliases = aliases.map((a) => (a.includes(year) ? a : `${a} ${year}`));
    }
  }

  let titleSearchVariations = generateVariations(
    germanTitle,
    input.mediaType,
    pack,
  );
  const allMatch = [...titleSearchVariations];

  if (aliases) {
    for (const alias of aliases) {
      allMatch.push(...generateVariations(alias, input.mediaType, pack));
      if (alias.includes(":")) {
        allMatch.push(alias.replace(/:/g, " -"));
      }
    }
  }

  if (germanTitle?.endsWith("(DE)")) {
    const replaced = removeExtraWhitespaces(
      germanTitle.replace(/\(DE\)/g, " GERMAN"),
    );
    titleSearchVariations = [
      ...titleSearchVariations,
      ...generateVariations(replaced, input.mediaType, pack),
    ];
    const withoutDe = germanTitle.replace(/\(DE\)/g, "").trim();
    allMatch.push(...generateVariations(withoutDe, input.mediaType, pack));
  }

  if (germanTitle && /germany$/i.test(germanTitle)) {
    const base = germanTitle.slice(0, -7);
    const replaced = removeExtraWhitespaces(`${base}GERMAN`);
    titleSearchVariations = [
      ...titleSearchVariations,
      ...generateVariations(replaced, input.mediaType, pack),
    ];
    allMatch.push(...generateVariations(base.trim(), input.mediaType, pack));
  }

  if (germanTitle?.includes(":")) {
    allMatch.push(germanTitle.replace(/:/g, " -"));
  }

  // Multi-language: for each active non-DE plugin, send the title in that
  // plugin's language through only its own maps. Example: Swedish plugin
  // active + titlesByLang.sv = "Stugan" -> produces "Stugan"/"Stügan"
  // substitutions without applying the German or French maps (which would
  // be a mismatch and pure noise).
  if (input.titlesByLang) {
    for (const plugin of pack.activePlugins) {
      if (plugin.language === "de") continue;
      const langTitle = input.titlesByLang[plugin.language];
      if (!langTitle) continue;
      const miniPack = aggregatePlugins([plugin]);
      const langVariations = generateVariations(
        langTitle,
        input.mediaType,
        miniPack,
      );
      titleSearchVariations.push(...langVariations);
      allMatch.push(...langVariations);
    }
  }

  // Dedup case-insensitively in a single pass, keeping the first occurrence's
  // original casing. (Was O(n^2): a Set of lowercased keys re-scanned with
  // `allMatch.find` per key.)
  const seenLower = new Map<string, string>();
  for (const v of allMatch) {
    const lower = v.toLowerCase();
    if (!seenLower.has(lower)) seenLower.set(lower, v);
  }
  const titleMatchVariations = Array.from(seenLower.values());

  return {
    titleSearchVariations: Array.from(new Set(titleSearchVariations)),
    titleMatchVariations,
    authorMatchVariations: [],
    aliases,
    germanTitle,
  };
}
