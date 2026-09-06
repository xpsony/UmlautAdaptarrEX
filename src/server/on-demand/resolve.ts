import { LRUCache } from "lru-cache";
import type { Logger } from "pino";
import { buildArrClient } from "@/arr";
import { prisma } from "@/lib/db";
import { describeError } from "@/lib/error-format";
import { isMaskedSecret } from "@/lib/secrets";
import { lookupTmdbIdByImdbId } from "@/providers/imdb-lookup";
import type { TitleProvider } from "@/providers/types";
import type { ArrType, ProviderId } from "@/schemas/instance";
import type { CachedSearchItem } from "@/server/search-item";
import type { AppState } from "@/server/state";

/** Hard ceiling for one resolution. Runs in parallel with the indexer fetch. */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * How long a miss is remembered. Without this, an id nobody knows would cost
 * one *Arr call plus up to three provider calls on every single request.
 */
export const NEGATIVE_TTL_MS = 30 * 60 * 1000;
const NEGATIVE_MAX = 2_000;

/**
 * A much shorter memory for a resolution that *failed* rather than came back
 * empty. "Nobody has this id" stays true for a while; "the *Arr was restarting"
 * does not, and blinding a title for half an hour over a transient error would
 * be a worse outcome than one extra attempt a minute later.
 */
export const ERROR_TTL_MS = 60 * 1000;

/** Why a resolution produced no item. Drives which negative window applies. */
export type NegativeOutcome = "empty" | "error" | "timeout";

/**
 * How long a non-result is remembered. Only a genuine "nobody has this id"
 * earns the long window; an error or an exhausted budget says nothing about
 * the id itself.
 *
 * Exported and pure so the policy is testable: `lru-cache` measures its TTL
 * on a clock vitest's fake timers cannot move, so the windows themselves
 * cannot be exercised by advancing time.
 */
export function negativeTtlFor(outcome: NegativeOutcome): number {
  return outcome === "empty" ? NEGATIVE_TTL_MS : ERROR_TTL_MS;
}

/**
 * Global ceiling on concurrent resolutions. A burst of unknown ids must not
 * stack arbitrarily many outbound calls. Over the limit we return null
 * immediately rather than queue: the caller's time budget is tight, and the
 * next request for the same id will find it in the index anyway.
 */
const MAX_CONCURRENT = 4;

const negativeCache = new LRUCache<string, true>({
  max: NEGATIVE_MAX,
  ttl: NEGATIVE_TTL_MS,
  ttlAutopurge: true,
});
const inFlight = new Map<string, Promise<CachedSearchItem | null>>();
let running = 0;

export interface OnDemandRequest {
  mediaType: "tv" | "movie";
  /** tvdbid or tmdbid, when the request carried one. */
  externalId: string | null;
  /** IMDb id (canonical `tt…` form), when the request carried only that. */
  imdbId: string | null;
}

/**
 * The logger surface this module needs, typed structurally so both pino's
 * `Logger` and Fastify's `FastifyBaseLogger` satisfy it. A request carries the
 * latter, and the two differ only in pino-internal fields we never touch.
 */
export interface OnDemandLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export interface OnDemandDeps {
  state: AppState;
  logger: OnDemandLogger;
  timeoutMs?: number;
}

/** Test seam: drops the negative cache and any in-flight bookkeeping. */
export function clearOnDemandCaches(): void {
  negativeCache.clear();
  inFlight.clear();
  running = 0;
}

const ARR_TYPE_FOR: Record<"tv" | "movie", ArrType> = {
  tv: "sonarr",
  movie: "radarr",
};

/**
 * Resolves a title the sync hasn't picked up yet, in the moment a search for
 * it arrives. Chain: negative cache, single-flight, imdbid to tmdbid, single
 * *Arr lookup, then the instance's provider via `deriveItems`.
 *
 * Never throws and never blocks past its budget: every failure path returns
 * null, and the caller then behaves exactly as it did before this existed.
 */
export async function resolveOnDemand(
  req: OnDemandRequest,
  deps: OnDemandDeps,
): Promise<CachedSearchItem | null> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const key = req.externalId
    ? `${req.mediaType}:${req.externalId}`
    : `${req.mediaType}:imdb:${req.imdbId}`;

  if (negativeCache.has(key)) return null;

  const existing = inFlight.get(key);
  if (existing) return existing;

  if (running >= MAX_CONCURRENT) {
    deps.logger.debug({ key, running }, "on-demand lookup skipped: concurrency cap");
    return null;
  }

  running += 1;
  const task = withTimeout(resolveUncached(req, deps), timeoutMs)
    .then((item) => {
      // A timeout is reported as `timedOut`, not as an empty answer: the
      // underlying resolution may still be running and may still index the
      // item, so it must not be remembered as a miss for the full window.
      if (item === TIMED_OUT) {
        negativeCache.set(key, true, { ttl: negativeTtlFor("timeout") });
        return null;
      }
      if (!item) negativeCache.set(key, true, { ttl: negativeTtlFor("empty") });
      return item;
    })
    .catch((err) => {
      deps.logger.debug({ key, err: describeError(err) }, "on-demand lookup failed");
      negativeCache.set(key, true, { ttl: negativeTtlFor("error") });
      return null;
    })
    .finally(() => {
      running -= 1;
      inFlight.delete(key);
    });
  inFlight.set(key, task);
  return task;
}

async function resolveUncached(
  req: OnDemandRequest,
  deps: OnDemandDeps,
): Promise<CachedSearchItem | null> {
  const started = Date.now();
  const { state, logger } = deps;
  // The *Arr client and the TMDB helper are typed against pino's Logger.
  // Structurally our logger satisfies what they call (info/debug/child), but
  // pino's type carries internal fields Fastify's does not declare, so the
  // nominal gap has to be bridged once here rather than at every call.
  const pinoLogger = logger as unknown as Logger;

  const externalId =
    req.externalId ??
    (req.imdbId
      ? await lookupTmdbIdByImdbId(state.settings.tmdbApiKey, req.imdbId, pinoLogger)
      : null);
  if (!externalId) return null;

  // An imdbid that just mapped to a tmdbid may well already be synced.
  const known = state.getByExternalId(req.mediaType, externalId);
  if (known) return known;

  const instances = await prisma.arrInstance.findMany({
    where: { enabled: true, type: ARR_TYPE_FOR[req.mediaType] },
  });
  if (instances.length === 0) return null;

  for (const instance of instances) {
    if (isMaskedSecret(instance.apiKey)) continue;
    const provider = state.providerForOrder(parseOrder(instance.providerOrder));
    if (!provider) continue;
    const client = buildArrClient({
      type: instance.type as ArrType,
      instanceId: instance.id,
      instanceName: instance.name,
      host: instance.host,
      apiKey: instance.apiKey,
      userAgent: state.settings.userAgent,
      provider: provider as TitleProvider,
      logger: pinoLogger,
    });
    const raw = await client.fetchRawItemByExternalId(externalId);
    if (!raw) continue;
    const [derived] = await client.deriveItems([raw]);
    if (!derived) continue;
    const item = state.indexEphemeral({
      // Synthetic: there is no SearchItem row. The `ephemeral` flag that
      // indexEphemeral sets is what stops this reaching RenameHistory.
      id: `on-demand:${req.mediaType}:${externalId}`,
      arrInstanceId: instance.id,
      arrId: derived.arrId,
      externalId: derived.externalId,
      imdbId: derived.imdbId,
      title: derived.title,
      expectedTitle: derived.expectedTitle,
      expectedAuthor: derived.expectedAuthor,
      germanTitle: derived.germanTitle,
      mediaType: derived.mediaType,
      year: derived.year,
      titleSearchVariations: derived.titleSearchVariations,
      titleMatchVariations: derived.titleMatchVariations,
      authorMatchVariations: derived.authorMatchVariations,
    });
    logger.info(
      {
        mediaType: req.mediaType,
        externalId,
        instance: instance.name,
        expectedTitle: item.expectedTitle,
        germanTitle: item.germanTitle,
        durationMs: Date.now() - started,
      },
      "on-demand title resolved",
    );
    return item;
  }

  logger.debug(
    { mediaType: req.mediaType, externalId, durationMs: Date.now() - started },
    "on-demand lookup: no instance knows this id",
  );
  return null;
}

const VALID_PROVIDERS: readonly ProviderId[] = ["pcjones", "tvdb", "tmdb"];

// Mirrors parseProviderOrder in src/server/sync/run.ts, falling back to the
// default chain instead of null: an on-demand lookup with a misconfigured
// order should still resolve rather than silently do nothing.
function parseOrder(csv: string | null): ProviderId[] {
  const seen = new Set<ProviderId>();
  for (const part of (csv ?? "").split(",")) {
    const id = part.trim() as ProviderId;
    if (VALID_PROVIDERS.includes(id)) seen.add(id);
  }
  return seen.size > 0 ? [...seen] : ["pcjones", "tvdb", "tmdb"];
}

/** Distinguishes "the budget ran out" from "the chain answered with nothing". */
const TIMED_OUT = Symbol("on-demand-timeout");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    p,
    new Promise<typeof TIMED_OUT>((resolve) => {
      setTimeout(() => resolve(TIMED_OUT), ms).unref?.();
    }),
  ]);
}
