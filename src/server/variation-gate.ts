import type { MediaType } from "@/domain/variations/generate";

/** One switch per media type: the shape of an indexer row. */
export type VariationSwitches = Record<MediaType, boolean>;

/** The four global switches as the settings snapshot names them. */
export interface GlobalVariationSettings {
  tvVariationSearch: boolean;
  movieVariationSearch: boolean;
  audioVariationSearch: boolean;
  bookVariationSearch: boolean;
}

export function globalVariationSwitches(s: GlobalVariationSettings): VariationSwitches {
  return {
    tv: s.tvVariationSearch,
    movie: s.movieVariationSearch,
    audio: s.audioVariationSearch,
    book: s.bookVariationSearch,
  };
}

/** An indexer row wins; without one the global switch of the media type applies. */
export function isVariationSearchEnabled(
  global: GlobalVariationSettings,
  indexer: VariationSwitches | undefined,
  mediaType: MediaType,
): boolean {
  return (indexer ?? globalVariationSwitches(global))[mediaType];
}

/**
 * The indexer identity: host and port of a legacy target, without the path,
 * lower-cased. Matches what RequestHistory.domain stores.
 */
export function indexerHost(domain: string): string {
  return (domain.split("/")[0] ?? "").toLowerCase();
}
