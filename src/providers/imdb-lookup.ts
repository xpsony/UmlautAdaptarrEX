import { LRUCache } from "lru-cache";
import { MovieDb } from "moviedb-promise";
import type { Logger } from "pino";
import { canonicalImdbId } from "@/lib/imdb-id";
import { describeError } from "@/lib/error-format";
import { looksLikeTmdbV4Token } from "./tmdb";

// Same per-request ceiling the TMDB provider uses, so a stalled connection
// can't outlive the on-demand budget that calls us.
const TMDB_REQUEST_TIMEOUT_MS = 15_000;

// imdb -> tmdb is an immutable mapping, so a plain unbounded-TTL LRU is
// enough. Small cap: only imdbid-only requests reach this path at all. Misses
// are deliberately NOT cached here - the on-demand resolver owns the negative
// cache, and a miss can also mean "TMDB was briefly unhappy".
const MAPPING_CACHE_MAX = 500;
const mappingCache = new LRUCache<string, string>({ max: MAPPING_CACHE_MAX });

/**
 * Maps an IMDb id to a TMDB movie id via TMDB's `find` endpoint.
 *
 * Needed because the search index and the *Arr APIs are keyed by tmdbid,
 * while Radarr may send only `imdbid`. Returns null when no TMDB key is
 * configured; that is a documented gap, not an error, and it is the reason
 * the imdbid-only path is inert without TMDB.
 */
export async function lookupTmdbIdByImdbId(
  apiKey: string | null,
  rawImdbId: string,
  logger?: Logger,
): Promise<string | null> {
  const imdbId = canonicalImdbId(rawImdbId);
  if (!imdbId) return null;
  if (!apiKey || looksLikeTmdbV4Token(apiKey)) return null;

  const cached = mappingCache.get(imdbId);
  if (cached) return cached;

  try {
    const client = new MovieDb(apiKey);
    // moviedb-promise types external_source as its own enum; the wire value
    // is the plain string TMDB documents.
    const res = await client.find(
      { id: imdbId, external_source: "imdb_id" as never },
      { timeout: TMDB_REQUEST_TIMEOUT_MS },
    );
    const first = res.movie_results?.[0];
    if (first?.id == null) return null;
    const tmdbId = String(first.id);
    mappingCache.set(imdbId, tmdbId);
    return tmdbId;
  } catch (err) {
    logger?.debug({ imdbId, err: describeError(err) }, "tmdb imdb-id lookup failed");
    return null;
  }
}

/** Test seam: drops the process-wide mapping cache. */
export function clearImdbMappingCache(): void {
  mappingCache.clear();
}
