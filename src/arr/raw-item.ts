import type { MediaType } from "@/domain/variations/generate";

/**
 * One item exactly as the *Arr instance reports it, before any TitleProvider
 * has been consulted. This is the unit the delta sync diffs against the DB
 * and the unit the on-demand lookup resolves for a single external id.
 *
 * `title` is both the display title and the canonical `expectedTitle`: every
 * *Arr client sets the two to the same value, so the distinction only exists
 * downstream in `SearchItemDerived`.
 */
export interface RawArrItem {
  arrId: number;
  /** tvdbid for tv, tmdbid for movie, derived key for audio/book. */
  externalId: string;
  /** Only Radarr supplies one. */
  imdbId: string | null;
  title: string;
  /** Release year (movie) / first-air year (tv). NULL for audio/book. */
  year: number | null;
  /** The *Arr's own alternateTitles, if any. */
  aliases: string[] | null;
  /** Only Radarr: the German entry picked out of alternateTitles. */
  germanTitle: string | null;
  mediaType: MediaType;
  /** Artist (Lidarr) / author (Readarr); NULL for tv/movie. */
  expectedAuthor: string | null;
}
