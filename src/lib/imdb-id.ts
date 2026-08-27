/**
 * The one canonical spelling of an IMDb id: lowercase `tt` plus digits.
 *
 * Why this exists: an incoming newznab request may carry either form
 * (`imdbid=1234567` or `imdbid=tt1234567`), `SearchItem.imdbId` from Radarr is
 * always `tt`-prefixed, and TMDB's `find` endpoint only accepts the prefixed
 * form. Returns null for anything that isn't an IMDb id.
 *
 * Note: `src/domain/xml/newznab-attrs.ts` has its own `numericImdbId` for the
 * opposite direction (the wire format Sonarr/Radarr parse). That duplication
 * is deliberate - the domain layer stays free of `src/lib` imports.
 */
export function canonicalImdbId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.trim().replace(/^tt/i, "");
  // Leading zeros are significant: tt0000900 is not tt900.
  return /^\d+$/.test(digits) ? `tt${digits}` : null;
}
