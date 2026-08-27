import { getMediaTypeFromCategory } from "../matching/category";
import { renameForBooksAndAudio } from "../matching/books-audio";
import {
  renameForMoviesAndTv,
  type RenameOptions,
  type RenameResult,
  type RenameSearchItem,
} from "../matching/rename";
import { replaceSeparatorsWithSpace } from "../matching/separator";
import { removeAccentButKeepDiacritics } from "../normalization/accents";
import { getActiveLanguagePack, type LanguagePack } from "../plugins";
import type { MediaType } from "../variations/generate";
import { buildXml, CDATA_KEY, ensureArray, parseXml } from "./parse";
import {
  attachExternalIdAttributes,
  externalIdAttributes,
  newznabNamespaceAttribute,
  resolveAttrKey,
} from "./newznab-attrs";

export interface RewriteSearchItem {
  expectedTitle: string;
  expectedAuthor: string | null;
  titleMatchVariations: string[];
  authorMatchVariations: string[];
  mediaType: MediaType;
  /**
   * The *Arr-side primary id — tvdbid for tv, tmdbid for movie. Emitted as a
   * newznab id attribute when `attachExternalIds` is on. Optional so the
   * pure-domain tests and older callers keep compiling.
   */
  externalId?: string | undefined;
  /** IMDb id, when the *Arr knows one (Radarr does for movies). */
  imdbId?: string | null | undefined;
  /** Release year for movies / first-air year for TV. Used by the matching
   * layer to refuse rewrites when the release carries a different year. */
  year?: number | null;
  /**
   * Per-item tolerance window passed to the matching layer. `null` disables
   * the year check entirely. A non-negative integer accepts release-name
   * years within +/-N of `year`. Sourced from the owning ArrInstance's
   * `enableYearMatching` + `yearMatchingTolerance` columns.
   */
  yearMatchingTolerance?: number | null;
}

type SearchItemLookup = (mediaType: MediaType, cleanTitle: string) => RewriteSearchItem | null;

export interface RewriteOptions {
  /** Concrete search item; when provided, `lookup` is ignored. */
  searchItem?: RewriteSearchItem | null | undefined;
  /** Per-item cache lookup; used when `searchItem` is null. */
  lookup?: SearchItemLookup | undefined;
  /** Invoked for every rewrite (e.g. to record RenameHistory). */
  onRename?:
    | ((event: { originalTitle: string; rewrittenTitle: string; mediaType: MediaType }) => void)
    | undefined;
  /**
   * Invoked when a search item *was* matched for an entry but the rename was
   * refused (year-mismatch, ambiguous-prefix, no-match). Lets callers surface
   * the reason for diagnostics; does not fire when there's no candidate item
   * at all (lookup miss).
   */
  onSkip?:
    | ((event: {
        originalTitle: string;
        mediaType: MediaType;
        reason: NonNullable<RenameResult["reason"]>;
        expectedTitle: string;
      }) => void)
    | undefined;
  /**
   * Active language pack from the live AppState. Defaults to the process-wide
   * active pack so that pure-domain callers (e.g. unit tests) keep working.
   */
  pack?: LanguagePack | undefined;
  /**
   * Operator-configurable rename behaviour (Settings -> Renaming). Omitted
   * means "today's defaults" — see `RenameOptions`.
   */
  rename?: RenameOptions | undefined;
  /**
   * Append the known external ids (tvdbid/tmdbid/imdb) to every rewritten
   * item as newznab attributes so Sonarr/Radarr can bind the release without
   * parsing its title.
   */
  attachExternalIds?: boolean | undefined;
}

type TextLike =
  string | { "#text"?: string; [k: string]: unknown } | { __cdata?: string; [k: string]: unknown };

interface RssItem {
  title?: TextLike;
  category?: TextLike | TextLike[];

  [key: string]: unknown;
}

function readTextField(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const cdata = obj[CDATA_KEY];
    if (typeof cdata === "string") return cdata;
    const t = obj["#text"];
    if (typeof t === "string") return t;
  }
  return null;
}

function writeTitle(item: RssItem, newTitle: string): void {
  // Preserve the original wire shape: CDATA-wrapped stays CDATA, plain stays
  // plain, attributed-text keeps its #text + attribute siblings.
  if (typeof item.title === "string") {
    item.title = newTitle;
    return;
  }
  if (item.title && typeof item.title === "object") {
    const obj = item.title as Record<string, unknown>;
    if (CDATA_KEY in obj) {
      obj[CDATA_KEY] = newTitle;
      return;
    }
    obj["#text"] = newTitle;
    return;
  }
  item.title = newTitle;
}

function readCategory(value: RssItem["category"]): string[] {
  // Many indexers attach multiple <category> elements to a single item, with
  // the most-specific sub-cat first (e.g. 5040 before 5000). Returning every
  // entry lets the classifier fall through to a recognised parent when the
  // first sub-cat is exotic, which prevents tv/audio/book items from being
  // dropped entirely from the rewrite (and therefore from RenameHistory).
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const v of list) {
    const text = readTextField(v);
    if (text) out.push(text);
  }
  return out;
}

export function rewriteIndexerXml(xml: string, options: RewriteOptions): string {
  const pack = options.pack ?? getActiveLanguagePack();
  const tree = parseXml(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
  };
  const channel = tree?.rss?.channel;
  if (!channel) return xml;

  const items = ensureArray(channel.item);
  if (items.length === 0) return xml;

  // Resolved once per response: which attr element the feed speaks and
  // whether we have to declare the namespace ourselves.
  const attrTarget = options.attachExternalIds
    ? resolveAttrKey(
        tree.rss as unknown as Record<string, unknown>,
        items[0] as unknown as Record<string, unknown>,
      )
    : null;
  let attachedAny = false;

  for (const item of items) {
    const originalTitle = readTextField(item.title);
    if (!originalTitle) continue;

    const cleanTitle = replaceSeparatorsWithSpace(
      removeAccentButKeepDiacritics(originalTitle, pack),
    );

    const cat = readCategory(item.category);
    const mediaType = getMediaTypeFromCategory(cat);
    if (!mediaType) continue;

    let searchItem: RewriteSearchItem | null = options.searchItem ?? null;
    if (!searchItem && options.lookup) {
      searchItem = options.lookup(mediaType, cleanTitle);
    }
    if (!searchItem) continue;

    let rewritten: string | null = null;
    if (mediaType === "tv" || mediaType === "movie") {
      const renameItem: RenameSearchItem = {
        expectedTitle: searchItem.expectedTitle,
        titleMatchVariations: searchItem.titleMatchVariations,
        year: searchItem.year ?? null,
      };
      // Forwarded only when explicitly set on the rewrite item; an absent
      // tolerance leaves the rename layer's default in effect. `null`
      // disables the year check; a number is +/-N tolerance around `year`.
      if (searchItem.yearMatchingTolerance !== undefined) {
        renameItem.yearMatchingTolerance = searchItem.yearMatchingTolerance;
      }
      const result = renameForMoviesAndTv(originalTitle, renameItem, pack, options.rename ?? {});
      rewritten = result.rewrittenTitle;
      if (!rewritten && result.reason) {
        options.onSkip?.({
          originalTitle,
          mediaType,
          reason: result.reason,
          expectedTitle: searchItem.expectedTitle,
        });
      }
    } else if (mediaType === "audio" || mediaType === "book") {
      if (!searchItem.expectedAuthor) continue;
      rewritten = renameForBooksAndAudio(
        originalTitle,
        {
          expectedTitle: searchItem.expectedTitle,
          expectedAuthor: searchItem.expectedAuthor,
          titleMatchVariations: searchItem.titleMatchVariations,
          authorMatchVariations: searchItem.authorMatchVariations,
        },
        pack,
        { stripSpecialChars: options.rename?.stripSpecialChars ?? false },
      ).rewrittenTitle;
    }

    if (rewritten && rewritten !== originalTitle) {
      writeTitle(item, rewritten);
      options.onRename?.({
        originalTitle,
        rewrittenTitle: rewritten,
        mediaType,
      });
    }

    // Id attributes are attached to every item we could resolve a search
    // item for — including the ones the rename declined. The id is correct
    // either way, and a refused rename is exactly the case where Sonarr
    // benefits most from not having to parse the title.
    if (attrTarget && searchItem.externalId) {
      const added = attachExternalIdAttributes(
        item as unknown as Record<string, unknown>,
        attrTarget.key,
        externalIdAttributes({
          mediaType,
          externalId: searchItem.externalId,
          imdbId: searchItem.imdbId,
        }),
      );
      if (added > 0) attachedAny = true;
    }
  }

  // Only declare the namespace once we actually emitted a prefixed element;
  // adding it to an untouched response would change bytes for nothing.
  if (attrTarget?.needsNamespaceDecl && attachedAny && tree.rss) {
    const ns = newznabNamespaceAttribute();
    (tree.rss as unknown as Record<string, unknown>)[ns.name] = ns.value;
  }

  return buildXml(tree);
}
