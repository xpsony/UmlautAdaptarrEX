import type { MediaType } from "@/domain/variations/generate";

export interface InstanceMatchOptions {
  enableYearMatching: boolean;
  yearMatchingTolerance: number;
}

export const DEFAULT_INSTANCE_OPTIONS: InstanceMatchOptions = {
  enableYearMatching: true,
  yearMatchingTolerance: 1,
};

export interface CachedSearchItem {
  id: string;
  arrInstanceId: string;
  arrId: number;
  externalId: string;
  /**
   * IMDb id when the *Arr knows one - emitted as a newznab `imdb` attribute.
   * Optional: only Radarr supplies it, and rows written before the
   * `rename_options` migration have none.
   */
  imdbId?: string | null;
  title: string;
  expectedTitle: string;
  expectedAuthor: string | null;
  germanTitle: string | null;
  mediaType: MediaType;
  /** Release/first-air year used for year-mismatch rejection at lookup time. */
  year: number | null;
  titleSearchVariations: string[];
  titleMatchVariations: string[];
  /**
   * `normalizeForComparison(variation, pack)` applied to each entry of
   * `titleMatchVariations`, same order/length. Precomputed once in
   * `indexItem` so per-request matching never re-normalizes the same
   * variation on every lookup.
   */
  normalizedMatchVariations: string[];
  authorMatchVariations: string[];
}

/**
 * Shape accepted by `SearchItemIndex.indexItem`: everything a
 * CachedSearchItem needs except `normalizedMatchVariations`, which only
 * `indexItem` can fill in (it requires the active LanguagePack). Keeping this
 * as a distinct type - rather than an optional field with a `!` assertion -
 * means callers that build a fresh item (sync, tests) never have to know
 * about normalization at construction time.
 */
export type CachedSearchItemInput = Omit<CachedSearchItem, "normalizedMatchVariations">;

/** Raw shape of the columns `toCachedSearchItem` consumes. */
export interface SearchItemRow {
  id: string;
  arrInstanceId: string;
  arrId: number;
  externalId: string;
  imdbId: string | null;
  title: string;
  expectedTitle: string;
  expectedAuthor: string | null;
  germanTitle: string | null;
  mediaType: string;
  year: number | null;
  titleSearchVariations: string;
  titleMatchVariations: string;
  authorMatchVariations: string;
}

/**
 * Prisma `select` matching SearchItemRow exactly - so boot doesn't pull
 * unused columns (e.g. `aliases`) for every row.
 */
export const SEARCH_ITEM_SELECT = {
  id: true,
  arrInstanceId: true,
  arrId: true,
  externalId: true,
  imdbId: true,
  title: true,
  expectedTitle: true,
  expectedAuthor: true,
  germanTitle: true,
  mediaType: true,
  year: true,
  titleSearchVariations: true,
  titleMatchVariations: true,
  authorMatchVariations: true,
} as const;

/** Throws when a variation column holds truncated or invalid JSON. */
export function toCachedSearchItem(row: SearchItemRow): CachedSearchItemInput {
  return {
    id: row.id,
    arrInstanceId: row.arrInstanceId,
    arrId: row.arrId,
    externalId: row.externalId,
    imdbId: row.imdbId,
    title: row.title,
    expectedTitle: row.expectedTitle,
    expectedAuthor: row.expectedAuthor,
    germanTitle: row.germanTitle,
    mediaType: row.mediaType as MediaType,
    year: row.year,
    titleSearchVariations: JSON.parse(row.titleSearchVariations) as string[],
    titleMatchVariations: JSON.parse(row.titleMatchVariations) as string[],
    authorMatchVariations: JSON.parse(row.authorMatchVariations) as string[],
  };
}
