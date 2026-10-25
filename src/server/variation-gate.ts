import type { MediaType } from "@/domain/variations/generate";
import type { IndexerVariationSetting } from "@/schemas/indexer-setting";

/** One switch per media type. */
export type VariationSwitches = Record<MediaType, boolean>;

/** One cap per media type. */
export type VariationCaps = Record<MediaType, number>;

/** The four global switches and caps as the settings snapshot names them. */
export interface GlobalVariationSettings {
  tvVariationSearch: boolean;
  movieVariationSearch: boolean;
  audioVariationSearch: boolean;
  bookVariationSearch: boolean;
  tvMaxTitleVariations: number;
  movieMaxTitleVariations: number;
  audioMaxTitleVariations: number;
  bookMaxTitleVariations: number;
}

export function globalVariationSwitches(s: GlobalVariationSettings): VariationSwitches {
  return {
    tv: s.tvVariationSearch,
    movie: s.movieVariationSearch,
    audio: s.audioVariationSearch,
    book: s.bookVariationSearch,
  };
}

export function globalVariationCaps(s: GlobalVariationSettings): VariationCaps {
  return {
    tv: s.tvMaxTitleVariations,
    movie: s.movieMaxTitleVariations,
    audio: s.audioMaxTitleVariations,
    book: s.bookMaxTitleVariations,
  };
}

/** An indexer row wins; without one the global switch of the media type applies. */
export function isVariationSearchEnabled(
  global: GlobalVariationSettings,
  indexer: IndexerVariationSetting | undefined,
  mediaType: MediaType,
): boolean {
  return indexer ? indexer[mediaType] : globalVariationSwitches(global)[mediaType];
}

/**
 * The cap on German variations for one search. Same precedence as the
 * switch: an indexer row wins as a whole, otherwise the global cap of the
 * media type applies.
 */
export function variationCap(
  global: GlobalVariationSettings,
  indexer: IndexerVariationSetting | undefined,
  mediaType: MediaType,
): number {
  return indexer ? indexer[`${mediaType}Max`] : globalVariationCaps(global)[mediaType];
}

/**
 * The indexer identity: host and port of a legacy target, without the path,
 * lower-cased. Matches what RequestHistory.domain stores.
 */
export function indexerHost(domain: string): string {
  return (domain.split("/")[0] ?? "").toLowerCase();
}
