import type { MediaType } from "@/domain/variations/generate";

/**
 * One title per language (BCP-47 short code: "de", "sv", "fr", "en", ...).
 * Providers only fill the languages they can deliver; Composite merges them.
 */
export interface TitlePayload {
  titlesByLang: Record<string, string>;
  /** Optional aliases per language (multiple alternateTitles for the same language). */
  aliasesByLang?: Record<string, string[]> | undefined;
  externalId?: string | undefined;
  /**
   * Backward-compat convenience mirror of `titlesByLang.de`. Existing code
   * (Radarr local picker, SearchItem builder, DbCache hot path) still reads
   * this shortcut instead of inlining `titlesByLang.de ?? null` everywhere.
   * New code should target `titlesByLang` directly.
   */
  germanTitle: string | null;
  /** Backward-compat convenience mirror of `aliasesByLang?.de ?? null`. */
  aliases: string[] | null;
}

/**
 * Per-item progress callback for `fetchBulk`. Providers invoke this as soon as
 * an `externalId` has been resolved (positive hit) so callers can persist the
 * payload incrementally instead of waiting for the entire bulk to finish.
 * `DbCachedTitleProvider` uses this to checkpoint sync progress, so a crash
 * mid-bulk does not discard the items already fetched.
 *
 * Providers do NOT fire `onItem` for items that returned no payload - negative
 * cache handling is left to the caller, which knows the requested-langs set.
 */
export type BulkFetchOnItem = (
  externalId: string,
  payload: TitlePayload,
) => void | Promise<void>;

export interface BulkFetchOptions {
  onItem?: BulkFetchOnItem;
}

/**
 * `langs` is optional. When omitted, the provider falls back to its default
 * (pcjones always DE; TMDB and Composite use whatever the active plugins
 * require). The sync path explicitly passes `requiredLanguages(activePack)`
 * from Composite so individual providers don't need to import the global
 * LanguagePack.
 */
export interface TitleProvider {
  name: string;

  /**
   * Languages this provider can effectively deliver. Composite uses this for
   * per-language routing. `["*"]` means every language (TMDB).
   */
  supportedLanguages(): readonly string[];

  fetchByExternalId(
    type: MediaType,
    externalId: string,
    langs?: readonly string[],
  ): Promise<TitlePayload | null>;

  fetchByTitle(
    type: MediaType,
    title: string,
    langs?: readonly string[],
  ): Promise<TitlePayload | null>;

  fetchBulk(
    type: MediaType,
    externalIds: string[],
    langs?: readonly string[],
    opts?: BulkFetchOptions,
  ): Promise<Map<string, TitlePayload>>;
}

/**
 * Helper: builds a `TitlePayload` from per-language data and fills the
 * backward-compat mirrors `germanTitle` / `aliases` automatically.
 */
export function makeTitlePayload(input: {
  titlesByLang: Record<string, string>;
  aliasesByLang?: Record<string, string[]> | undefined;
  externalId?: string | undefined;
}): TitlePayload {
  const germanTitle = input.titlesByLang["de"] ?? null;
  const deAliases = input.aliasesByLang?.["de"] ?? null;
  return {
    titlesByLang: input.titlesByLang,
    aliasesByLang: input.aliasesByLang,
    externalId: input.externalId,
    germanTitle,
    aliases: deAliases && deAliases.length > 0 ? deAliases : null,
  };
}

/**
 * Merges two payloads into a single language map (the later provider only
 * wins when the first had nothing for that language). Composite uses this
 * to combine pcjones + TMDB responses per `externalId`.
 */
export function mergePayloads(
  primary: TitlePayload | null,
  secondary: TitlePayload | null,
): TitlePayload | null {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const titlesByLang: Record<string, string> = { ...primary.titlesByLang };
  for (const [lang, title] of Object.entries(secondary.titlesByLang)) {
    if (!titlesByLang[lang]) titlesByLang[lang] = title;
  }
  const aliasesByLang: Record<string, string[]> = {
    ...(primary.aliasesByLang ?? {}),
  };
  if (secondary.aliasesByLang) {
    for (const [lang, list] of Object.entries(secondary.aliasesByLang)) {
      const existing = aliasesByLang[lang] ?? [];
      const merged = [...existing, ...list].filter(
        (v, i, a) => a.indexOf(v) === i,
      );
      if (merged.length > 0) aliasesByLang[lang] = merged;
    }
  }
  return makeTitlePayload({
    titlesByLang,
    aliasesByLang:
      Object.keys(aliasesByLang).length > 0 ? aliasesByLang : undefined,
    externalId: primary.externalId ?? secondary.externalId,
  });
}
