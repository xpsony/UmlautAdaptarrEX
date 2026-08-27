import type { MediaType } from "../variations/generate";

// Newznab/Torznab id attributes, as the *Arr actually read them:
//
//   Sonarr  NewznabRssParser -> "tvdbid", "rageid", "imdb"
//   Radarr  NewznabRssParser -> "tmdbid", "imdb"
//
// Both parse "imdb" with int.TryParse, so the value must be the NUMERIC part
// of the IMDb id - a "tt"-prefixed value is silently dropped.
const NEWZNAB_NS = "http://www.newznab.com/DTD/2010/feeds/attributes/";

export interface ExternalIdSource {
  mediaType: MediaType;
  /** tvdbid for tv, tmdbid for movie. Empty/non-numeric values are skipped. */
  externalId: string;
  /** IMDb id in either form ("tt0463854" or "0463854"). Optional. */
  imdbId?: string | null | undefined;
}

interface AttrNode {
  "@_name": string;
  "@_value": string;
}

/**
 * The attribute element name to use, derived from what the feed already
 * speaks. A Torznab feed declares `xmlns:torznab` and its items carry
 * `torznab:attr`; a Newznab feed uses `newznab:attr`. Emitting the wrong
 * prefix (or an undeclared one) yields XML the *Arr reject outright, so we
 * mirror the feed and only fall back to `newznab:attr` - declaring the
 * namespace ourselves - when the feed carries no attrs at all.
 */
export function resolveAttrKey(
  rssAttributes: Record<string, unknown>,
  sampleItem: Record<string, unknown> | undefined,
): { key: string; needsNamespaceDecl: boolean } {
  if (sampleItem && "torznab:attr" in sampleItem) {
    return { key: "torznab:attr", needsNamespaceDecl: false };
  }
  if (sampleItem && "newznab:attr" in sampleItem) {
    return { key: "newznab:attr", needsNamespaceDecl: false };
  }
  if ("@_xmlns:torznab" in rssAttributes) {
    return { key: "torznab:attr", needsNamespaceDecl: false };
  }
  if ("@_xmlns:newznab" in rssAttributes) {
    return { key: "newznab:attr", needsNamespaceDecl: false };
  }
  return { key: "newznab:attr", needsNamespaceDecl: true };
}

export function newznabNamespaceAttribute(): { name: string; value: string } {
  return { name: "@_xmlns:newznab", value: NEWZNAB_NS };
}

/** Strips a leading "tt" so the value survives the *Arr's int.TryParse. */
function numericImdbId(raw: string): string | null {
  const digits = raw.trim().replace(/^tt/i, "");
  return /^\d+$/.test(digits) ? digits : null;
}

/**
 * The id attributes worth adding for one item. `tvdbid`/`tmdbid` come from
 * the item's `externalId` (which is exactly that id, per media type);
 * `imdb` is added whenever the *Arr told us one.
 */
export function externalIdAttributes(
  source: ExternalIdSource,
): ReadonlyArray<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  const primaryName =
    source.mediaType === "tv" ? "tvdbid" : source.mediaType === "movie" ? "tmdbid" : null;
  // Only numeric ids: Lidarr/Readarr externalIds are titles, and both *Arr
  // parse these attributes as integers.
  if (primaryName && /^\d+$/.test(source.externalId.trim())) {
    out.push({ name: primaryName, value: source.externalId.trim() });
  }
  if (source.imdbId) {
    const numeric = numericImdbId(source.imdbId);
    if (numeric) out.push({ name: "imdb", value: numeric });
  }
  return out;
}

/**
 * Adds the given id attributes to one parsed `<item>` under `attrKey`,
 * skipping any name the indexer already supplied - its value is
 * authoritative and overwriting it could point the *Arr at the wrong medium.
 * Mutates `item` in place.
 */
export function attachExternalIdAttributes(
  item: Record<string, unknown>,
  attrKey: string,
  attributes: ReadonlyArray<{ name: string; value: string }>,
): number {
  if (attributes.length === 0) return 0;
  const existing = item[attrKey];
  const list: AttrNode[] =
    existing === undefined
      ? []
      : Array.isArray(existing)
        ? (existing as AttrNode[])
        : [existing as AttrNode];
  const present = new Set(
    list.map((a) => String(a?.["@_name"] ?? "").toLowerCase()).filter((n) => n.length > 0),
  );
  let added = 0;
  for (const attr of attributes) {
    if (present.has(attr.name)) continue;
    list.push({ "@_name": attr.name, "@_value": attr.value });
    present.add(attr.name);
    added += 1;
  }
  if (added > 0) item[attrKey] = list;
  return added;
}
