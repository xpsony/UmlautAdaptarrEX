// Built-in plugin contract for language-specific title transformations.
//
// A plugin contributes character substitutions, optional articles to strip
// from title prefixes, and the diacritic chars that should be treated as
// "word characters" for matching/regex purposes. Plugins are aggregated into
// a `LanguagePack` (see ./aggregate) which then drives variation generation,
// normalization, and rename matching.

export interface VariationPlugin {
  /** Stable identifier, used as the Prisma `Plugin.id` primary key. */
  id: string;
  /**
   * BCP-47 short code (e.g. "de", "sv", "fr"). Controls *which language
   * title* from the title-provider response is fed into this plugin. With
   * the Swedish plugin enabled, variations are generated on
   * `titlesByLang.sv`, not on the German title.
   *
   * Deliberately explicit instead of derived from `id` so multiple variants
   * within the same language (e.g. `austrian-phonetic` with `language: "de"`)
   * are allowed later.
   */
  language: string;
  /** i18n key for the display name (e.g. `plugins.germanUmlauts.name`). */
  nameKey: string;
  /** i18n key for the description shown under the toggle. */
  descriptionKey: string;
  /** Whether the plugin is enabled by default the first time it is seeded. */
  defaultEnabled: boolean;

  /**
   * Each map produces one variation by applying every substitution within it.
   * E.g. for German: one map maps ä→ae, another maps ä→a - yielding two
   * distinct variations per input title.
   */
  variationMaps: ReadonlyArray<Readonly<Record<string, string>>>;

  /**
   * Extra maps applied only for `mediaType ∈ {audio, book}` (e.g. strip
   * diacritics entirely). Optional.
   */
  audioOnlyMaps?: ReadonlyArray<Readonly<Record<string, string>>>;

  /**
   * Single canonical map used by `normalizeForComparison()` to fold
   * diacritics for cross-variation matching (typically the "lossy" map,
   * e.g. ä→a, ß→ss). All active plugins' comparison maps are merged.
   */
  comparisonMap: Readonly<Record<string, string>>;

  /**
   * Articles that should optionally be stripped from a title's prefix
   * (recursive in `generateVariations`). Plugin contributes its own list;
   * the engine takes the union across all active plugins.
   */
  articles?: ReadonlyArray<string>;

  /**
   * Extra characters (single chars, both cases) that should be treated as
   * "word characters" by the rename regex (`[a-z0-9...]`). E.g. German
   * contributes `äöüßÄÖÜ`. Plugins' `wordChars` are concatenated and
   * deduplicated by the aggregator.
   */
  wordChars?: string;
}
