import { removeAccent } from "./accents";

// The character classes of Lidarr's SearchCriteriaBase. .NET's `\w` is
// [\p{L}\p{Mn}\p{Nd}\p{Pc}]; the apostrophe is kept on purpose.
const NON_WORD = /[^\p{L}\p{Mn}\p{Nd}\p{Pc}']+/gu;
const BEGINNING_THE = /^the\s/i;
const SINGLE_QUOTES = /[`´‘’]/g;

/**
 * Lidarr's `SearchCriteriaBase.GetQueryTitle`: what Lidarr sends for an
 * artist or album name unless the indexer reports `searchEngine="raw"`. Lidarr
 * joins the words with "+", which its `NewsnabifyTitle` turns back into
 * spaces before sending, so this writes spaces directly.
 *
 * Note what it does: it strips accents, umlauts included ("Bären" becomes
 * "Baren"), and only an English leading "The".
 */
export function lidarrQueryTitle(title: string): string {
  const source = title === "Various Artists" ? "VA" : title;
  const clean = removeAccent(
    source.replace(BEGINNING_THE, "").replace(SINGLE_QUOTES, "'").replace(NON_WORD, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return clean.length === 0 ? source : clean;
}

/**
 * The form both sides of the Lidarr lookup are reduced to: the keys stored at
 * sync time and the `q` of an incoming search. Case, accents, punctuation and
 * spacing are folded away, so the raw and the cleaned spelling of the same
 * words meet.
 */
export function lidarrSearchKey(text: string): string {
  return removeAccent(text.replace(SINGLE_QUOTES, "'").replace(NON_WORD, " "))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface LidarrAlbumKeyInput {
  artist: string;
  album: string;
  disambiguation?: string | null | undefined;
  /** Release year; Lidarr sends 0 for an album without a release date. */
  year?: number | null | undefined;
}

// Lidarr's AlbumSearchCriteria plus the self-titled rule of its Newznab
// request generator: when artist and album query are equal, the year is added.
function textSearchQuery(artistQuery: string, albumQuery: string, year: number): string {
  return artistQuery === albumQuery
    ? `${artistQuery} ${albumQuery} ${year}`
    : `${artistQuery} ${albumQuery}`;
}

/**
 * Every key a Lidarr text search (`t=search&q=...`) for this album can arrive
 * under: first the default cleaned query, then the raw one sent to indexers
 * with `searchEngine="raw"`. Deduplicated, so usually a single key.
 */
export function lidarrAlbumSearchKeys(input: LidarrAlbumKeyInput): string[] {
  const disambiguation = input.disambiguation?.trim();
  const rawAlbum = disambiguation ? `${input.album} ${disambiguation}` : input.album;
  const year = input.year ?? 0;
  const cleaned = textSearchQuery(lidarrQueryTitle(input.artist), lidarrQueryTitle(rawAlbum), year);
  const raw = textSearchQuery(input.artist, rawAlbum, year);
  return Array.from(new Set([lidarrSearchKey(cleaned), lidarrSearchKey(raw)]));
}
