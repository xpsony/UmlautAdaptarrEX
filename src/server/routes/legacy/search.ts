import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/db";
import { canonicalImdbId } from "@/lib/imdb-id";
import {
  getLidarrTitleForExternalId,
  getReadarrTitleForExternalId,
} from "@/domain/normalization/index";
import { aggregateIndexerResponses, rewriteIndexerXml } from "@/domain/xml";
import type { IndexerFetcher } from "@/server/proxy/indexer-fetcher";
import { type AppState, type CachedSearchItem, getAppState } from "@/server/state";
import { type OnDemandRequest, resolveOnDemand } from "@/server/on-demand/resolve";
import {
  assertLegacyContext,
  buildIndexerUrl,
  buildVariationSearch,
  type LegacyContext,
  recordRequest,
} from "./util";

export interface LegacySearchDeps {
  fetcher: IndexerFetcher;
}

type SearchType = "search" | "tvsearch" | "movie" | "music" | "book";

interface RouteSpec {
  type: SearchType;
}

// Mirrors the old SearchController constants - used by the generic `?t=search`
// route to decide whether the query is for Readarr (book) or Lidarr (audio).
const READARR_CATEGORY_IDS = new Set([
  "3030",
  "3130",
  "7000",
  "7010",
  "7020",
  "7030",
  "7100",
  "7110",
  "7120",
  "7130",
]);
const LIDARR_CATEGORY_IDS = new Set(["3000", "3010", "3020", "3040", "3050"]);

// Reproduces SearchController's per-action upfront lookup. Returning null
// means "no upfront searchItem" - rewrites still happen via per-item title
// lookup against the cache (matches old `useCacheService = searchItem == null`
// path in TitleMatchingService.RenameTitlesInContent).
function determineSearchItem(
  spec: RouteSpec,
  params: URLSearchParams,
  state: AppState,
): CachedSearchItem | null {
  const q = params.get("q");
  switch (spec.type) {
    case "tvsearch": {
      const tvdbid = params.get("tvdbid");
      if (tvdbid) return state.getByExternalId("tv", tvdbid);
      if (q) return state.findByTitle("tv", q);
      return null;
    }
    case "search": {
      if (!q) return null;
      const cat = params.get("cat");
      if (!cat) return null;
      const cats = cat.split(",").map((c) => c.trim());
      if (cats.some((c) => READARR_CATEGORY_IDS.has(c))) {
        return state.getByExternalId("book", getReadarrTitleForExternalId(q));
      }
      if (cats.some((c) => LIDARR_CATEGORY_IDS.has(c))) {
        return state.getByExternalId("audio", getLidarrTitleForExternalId(q));
      }
      return null;
    }
    case "movie":
    case "music":
    case "book":
      // Old MovieSearch/MusicSearch/BookSearch pass searchItem=null to
      // BaseSearch. Per-item rewrites still happen via the cache lookup.
      return null;
  }
}

/**
 * The item that drives the OUTBOUND variation search. Deliberately separate
 * from `determineSearchItem`, which drives the response rewrite.
 *
 * Why the split: `rewriteIndexerXml` ignores its `lookup` callback as soon as
 * `searchItem` is set, so giving the movie route an upfront item would stop
 * releases of *other* movies in the same response from being rewritten. The
 * fan-out has no such constraint, so movies can have a fan-out item while the
 * rewrite keeps the per-item lookup path.
 */
function resolveFanoutItem(
  spec: RouteSpec,
  params: URLSearchParams,
  state: AppState,
  rewriteItem: CachedSearchItem | null,
): CachedSearchItem | null {
  switch (spec.type) {
    case "tvsearch":
    case "search":
      // The rewrite item already IS the fan-out item for these two. Reusing
      // it rather than re-deriving keeps the request to one index lookup.
      return rewriteItem;
    case "movie": {
      const tmdbid = params.get("tmdbid");
      if (tmdbid) return state.getByExternalId("movie", tmdbid);
      const imdbId = canonicalImdbId(params.get("imdbid"));
      return imdbId ? state.getByImdbId(imdbId) : null;
    }
    case "music":
    case "book":
      return null;
  }
}

/**
 * The on-demand target for a request, or null when there is nothing to
 * resolve: no usable id, an id we already have, or a media type without a
 * TitleProvider (audio/book).
 *
 * Note the index check: the `movie` route deliberately keeps `searchItem` at
 * null (see determineSearchItem), so without this check every movie search
 * would trigger a lookup for a title we already know.
 */
function onDemandTargetFor(
  spec: RouteSpec,
  params: URLSearchParams,
  state: AppState,
): OnDemandRequest | null {
  switch (spec.type) {
    case "tvsearch": {
      const tvdbid = params.get("tvdbid");
      if (!tvdbid) return null;
      if (state.getByExternalId("tv", tvdbid)) return null;
      return { mediaType: "tv", externalId: tvdbid, imdbId: null };
    }
    case "movie": {
      const tmdbid = params.get("tmdbid");
      if (tmdbid) {
        if (state.getByExternalId("movie", tmdbid)) return null;
        return { mediaType: "movie", externalId: tmdbid, imdbId: null };
      }
      const imdbId = canonicalImdbId(params.get("imdbid"));
      if (!imdbId) return null;
      if (state.getByImdbId(imdbId)) return null;
      return { mediaType: "movie", externalId: null, imdbId };
    }
    // `search` only resolves Readarr/Lidarr categories, and `music`/`book`
    // are audio/book - no TitleProvider is consulted for either.
    default:
      return null;
  }
}

/**
 * Whether an on-demand resolved item may fill the upfront `searchItem` slot.
 * Mirrors determineSearchItem's per-type behaviour: only `tvsearch` has such
 * a slot today. For `movie` the resolved item still helps, via the ephemeral
 * index that the per-item `lookup` callback reads.
 */
function acceptsUpfrontItem(spec: RouteSpec): boolean {
  return spec.type === "tvsearch";
}

/**
 * The id to record in `RenameHistory.matchedSearchItemId`. An ephemeral item
 * has a synthetic id and no `SearchItem` row behind it, so recording it would
 * leave a dangling reference (the column has no foreign key to catch it).
 */
function matchedSearchItemId(item: CachedSearchItem | null): string | null {
  if (!item || item.ephemeral) return null;
  return item.id;
}

/**
 * Mirrors SearchControllerBase.BaseSearch's variation list builder, split in
 * two so the cap can apply to the generated German variations alone.
 *
 * `tail` is the highest-value part of the list - the user's literal `q` and
 * the canonical `expectedTitle` - and is never subject to the cap. That is
 * why a cap of 3 means "three German variations", not "three requests".
 */
function buildVariationList(
  searchItem: CachedSearchItem,
  searchQuery: string,
): { generated: string[]; tail: string[] } {
  const generated: string[] = [...searchItem.titleSearchVariations];
  const tail: string[] = [];
  if (searchQuery) {
    // Old behavior: if the query is already in the alias list, drop it (the
    // alias query covers it); otherwise append the user's literal query so it
    // is still searched alongside the German variations.
    const idx = generated.indexOf(searchQuery);
    if (idx >= 0) {
      generated.splice(idx, 1);
    } else {
      tail.push(searchQuery);
    }
  }
  // TODO_FORCE_TEXT_SEARCH_ORIGINAL_TITLE was hard-coded `true` in the legacy
  // code, so always include the canonical expected title.
  const expected = searchItem.expectedTitle;
  if (expected && expected !== searchQuery && !generated.includes(expected)) {
    tail.push(expected);
  }
  return { generated, tail };
}

export async function handleSearch(
  req: FastifyRequest,
  reply: FastifyReply,
  spec: RouteSpec,
  deps: LegacySearchDeps,
): Promise<void> {
  const start = Date.now();
  const ctx = assertLegacyContext(req, reply, spec.type);
  if (!ctx) return;

  const params = new URLSearchParams(ctx.search);
  const externalId = params.get("tvdbid") ?? params.get("tmdbid") ?? params.get("imdbid") ?? null;
  const q = params.get("q");

  const state = getAppState();
  let searchItem = determineSearchItem(spec, params, state);
  let fanoutItem = resolveFanoutItem(spec, params, state, searchItem);
  // While paused, the legacy path becomes a transparent pass-through: no
  // outbound variation fan-out and no response-XML rewriting. Logging and
  // request-history accounting stay intact because the gate sits inside the
  // rewrite callback rather than at the route entry.
  const isPaused = state.isPausedNow();

  // Start the on-demand resolution now but await it together with the main
  // fetch below: the added latency is then max(lookup, fetch) instead of the
  // sum, which in practice is close to zero. While paused we stay a
  // transparent pass-through and resolve nothing.
  const onDemandTarget =
    searchItem || fanoutItem || isPaused || !state.settings.onDemandLookup
      ? null
      : onDemandTargetFor(spec, params, state);
  const onDemand = onDemandTarget
    ? resolveOnDemand(onDemandTarget, { state, logger: req.log })
    : null;

  const userAgent = String(req.headers["user-agent"] ?? "");
  const responses: string[] = [];
  let lastStatus = 200;
  let lastContentType = "application/xml";
  let cacheHit = true;

  const rewriteResponse = (body: string): string => {
    if (!body || isPaused) return body;
    return rewriteIndexerXml(body, {
      pack: state.languagePack,
      // Operator-configurable renaming (Settings -> Renaming). Read per
      // response off the live settings snapshot so a saved change takes
      // effect on the next request without a restart.
      rename: state.renameOptions,
      attachExternalIds: state.settings.renameAttachExternalIds,
      searchItem: searchItem ? state.toRewriteSearchItem(searchItem) : null,
      lookup: searchItem
        ? undefined
        : (mediaType, cleanTitle) => {
            const found = state.findByTitle(mediaType, cleanTitle);
            return found ? state.toRewriteSearchItem(found) : null;
          },
      onSkip: (event) => {
        req.log.debug(
          {
            domain: ctx.domain,
            route: spec.type,
            mediaType: event.mediaType,
            reason: event.reason,
            originalTitle: event.originalTitle,
            expectedTitle: event.expectedTitle,
          },
          "title rewrite skipped",
        );
      },
      onRename: (event) => {
        req.log.info(
          {
            domain: ctx.domain,
            route: spec.type,
            mediaType: event.mediaType,
            originalTitle: event.originalTitle,
            rewrittenTitle: event.rewrittenTitle,
            matchedSearchItemId: matchedSearchItemId(searchItem),
            expectedTitle: searchItem?.expectedTitle ?? null,
          },
          "title rewritten",
        );
        void prisma.renameHistory
          .create({
            data: {
              originalTitle: event.originalTitle,
              rewrittenTitle: event.rewrittenTitle,
              mediaType: event.mediaType,
              matchedSearchItemId: matchedSearchItemId(searchItem),
            },
          })
          .catch((dbErr) => {
            req.log.debug({ err: dbErr }, "renameHistory insert failed");
          });
      },
    });
  };

  try {
    const [main, resolved] = await Promise.all([
      deps.fetcher.fetch(buildIndexerUrl(ctx), { "user-agent": userAgent }),
      onDemand ?? Promise.resolve(null),
    ]);
    if (resolved) {
      if (!searchItem && acceptsUpfrontItem(spec)) searchItem = resolved;
      fanoutItem ??= resolved;
    }
    lastStatus = main.status;
    lastContentType = main.contentType;
    cacheHit = cacheHit && main.cacheHit;

    let initialBody = main.body.toString("utf8");
    if (lastStatus === 200) {
      initialBody = rewriteResponse(initialBody);
    }

    // Match SearchControllerBase.BaseSearch ordering: aggregate variations
    // first, then merge the initial response last so dedup keeps variation
    // hits ahead of the (typically less specific) original query.
    // Per-media-type gate: German variation search is opt-out for series
    // (today's behaviour) and, for existing installs, opt-in for movies.
    const fanoutEnabled = fanoutItem
      ? fanoutItem.mediaType === "tv"
        ? state.settings.tvVariationSearch
        : state.settings.movieVariationSearch
      : false;
    if (
      fanoutItem &&
      lastStatus === 200 &&
      fanoutItem.expectedTitle &&
      !isPaused &&
      fanoutEnabled
    ) {
      const { generated, tail } = buildVariationList(fanoutItem, q ?? "");
      const cap = state.settings.maxTitleVariations;
      const capped = generated.length > cap;
      // The cap applies to the generated German variations only; the tail
      // (the literal `q` / the canonical `expectedTitle`) is the
      // highest-value part of the list and always survives. Order matters:
      // generated before tail before the main response, because the dedup
      // priority in aggregateIndexerResponses depends on it.
      const variations = [...generated.slice(0, cap), ...tail];
      const requested = generated.length + tail.length;
      // Budget for the whole variation phase, derived from the configured
      // indexer timeout so it scales with how patient the operator has told
      // us to be with a single indexer request. This is best-effort: the
      // check only runs BETWEEN fetches, so a single in-flight fetch (rate-
      // limit wait + fetch timeout) can still push the total past the budget.
      const deadlineMs = state.settings.indexerTimeoutSeconds * 1000 * 0.75;
      let deadlineHit = false;
      let fetched = 0;
      for (const variation of variations) {
        if (Date.now() - start > deadlineMs) {
          deadlineHit = true;
          break;
        }
        fetched++;
        const variationCtx: LegacyContext = {
          ...ctx,
          search: buildVariationSearch(ctx.search, variation),
        };
        const extra = await deps.fetcher.fetch(buildIndexerUrl(variationCtx), {
          "user-agent": userAgent,
        });
        cacheHit = cacheHit && extra.cacheHit;
        if (extra.status === 200 && extra.body.length > 0) {
          responses.push(rewriteResponse(extra.body.toString("utf8")));
        }
      }
      // A cap that simply did what it was configured to do is not a warning -
      // with the default of 1 it is the normal outcome for any item with more
      // than one German variation, and every warn line becomes a LogEntry row.
      // A missed deadline is the genuine anomaly and keeps the warn level.
      if (deadlineHit) {
        req.log.warn(
          {
            domain: ctx.domain,
            route: spec.type,
            query: q,
            requested,
            fetched,
            capped,
            deadlineHit,
            durationMs: Date.now() - start,
          },
          "legacy search variation fan-out hit the deadline",
        );
      } else if (capped) {
        req.log.debug(
          {
            domain: ctx.domain,
            route: spec.type,
            query: q,
            requested,
            fetched,
            cap,
            durationMs: Date.now() - start,
          },
          "legacy search variation fan-out capped",
        );
      }
      responses.push(initialBody);
    } else {
      responses.push(initialBody);
    }

    const aggregated = responses.length > 1 ? aggregateIndexerResponses(responses) : responses[0]!;
    reply.code(lastStatus).header("content-type", lastContentType).send(aggregated);
  } catch (err) {
    req.log.error(
      {
        err,
        domain: ctx.domain,
        route: spec.type,
        query: q,
        externalId,
      },
      "indexer search failed",
    );
    reply.code(502).send("Bad gateway");
    lastStatus = 502;
  }

  // cacheHit means "the response we delivered came from the indexer cache".
  // Only 2xx responses are ever stored (indexer-fetcher.ts), so a non-2xx
  // final status must report cacheHit=false even when the main fetch was a
  // cache hit but a later variation throw fell into the catch above.
  const recordedCacheHit = cacheHit && lastStatus >= 200 && lastStatus < 300;
  await recordRequest(
    {
      apiKey: ctx.apiKey,
      domain: ctx.domain,
      type: spec.type,
      query: q,
      externalId,
      status: lastStatus,
      durationMs: Date.now() - start,
      cacheHit: recordedCacheHit,
    },
    req,
  );

  // Slow-search visibility: surface anything > 8s separately so it stands out
  // from the normal "indexer search failed" error path.
  const totalMs = Date.now() - start;
  if (lastStatus < 400 && totalMs > 8_000) {
    req.log.warn(
      {
        route: spec.type,
        domain: ctx.domain,
        durationMs: totalMs,
        responses: responses.length,
        cacheHit,
        externalId,
      },
      "legacy search slow",
    );
  }
}
