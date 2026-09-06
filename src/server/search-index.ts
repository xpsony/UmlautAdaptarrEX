import { getCleanTitle } from "@/domain/normalization/clean";
import {
  normalizeForComparison,
  normalizedCharContribution,
} from "@/domain/normalization/comparison";
import type { LanguagePack } from "@/domain/plugins";
import type { MediaType } from "@/domain/variations/generate";
import type { CachedSearchItem, CachedSearchItemInput, InstanceMatchOptions } from "./search-item";

const RELEASE_YEAR_RE = /(?<![A-Za-z0-9])(19|20)\d{2}(?![A-Za-z0-9])/g;

function extractReleaseYears(title: string): number[] {
  const out: number[] = [];
  for (const m of title.matchAll(RELEASE_YEAR_RE)) out.push(Number(m[0]));
  return out;
}

// Walks the original string and returns the index after enough characters
// have been consumed to cover `targetCount` normalized chars. Mirrors the
// walk used in src/domain/matching/rename.ts so findByTitle can apply the
// same token-boundary check.
function mapNormalizedLengthToOriginal(
  original: string,
  targetCount: number,
  pack: LanguagePack,
): number {
  let matched = 0;
  for (let i = 0; i < original.length; i++) {
    matched += normalizedCharContribution(original[i]!, pack);
    if (matched >= targetCount) return i + 1;
  }
  return original.length;
}

/** Resolves the owning instance's match options for a candidate item. */
export type ResolveInstanceOptions = (instanceId: string) => InstanceMatchOptions;

/**
 * The SearchItem lookup index: external-id map, IMDb-id map and normalized
 * title-prefix buckets, plus the release-title matching on top of them.
 *
 * Deliberately free of settings, Prisma and provider knowledge - it takes the
 * LanguagePack and the instance-option resolver as arguments. `AppState` owns
 * two of these: one for synced items and one ephemeral tier.
 */
export class SearchItemIndex {
  // Keyed `${type}:${externalId}` WITHOUT instanceId: two instances sharing
  // the same medium collapse onto one entry and the last indexed write wins.
  private byExternalId = new Map<string, CachedSearchItem>();
  private byImdbId = new Map<string, CachedSearchItem>();
  private byTitlePrefix = new Map<string, CachedSearchItem[]>(); // `${type}:${prefix5}`

  /**
   * Invariant: not idempotent per object identity - calling this twice with
   * equivalent input duplicates bucket entries, since each call builds a
   * fresh `indexed` object. Call `removeItem` (or `removeItemsForInstance`,
   * or `clear`) before re-indexing.
   */
  indexItem(item: CachedSearchItemInput, pack: LanguagePack): CachedSearchItem {
    // Normalize each match variation exactly once, reusing the result for
    // both the byTitlePrefix bucket key and the stored array that
    // bestVariationMatchLen reads at request time.
    const normalizedMatchVariations = item.titleMatchVariations.map((variation) =>
      normalizeForComparison(variation, pack),
    );
    const indexed: CachedSearchItem = { ...item, normalizedMatchVariations };
    this.byExternalId.set(`${indexed.mediaType}:${indexed.externalId}`, indexed);
    if (indexed.imdbId) this.byImdbId.set(indexed.imdbId, indexed);
    for (const norm of normalizedMatchVariations) {
      const prefix = `${indexed.mediaType}:${norm.slice(0, 5)}`;
      let bucket = this.byTitlePrefix.get(prefix);
      if (!bucket) {
        bucket = [];
        this.byTitlePrefix.set(prefix, bucket);
      }
      if (!bucket.includes(indexed)) bucket.push(indexed);
    }
    return indexed;
  }

  /**
   * Removes one item from all three maps. Uses the item's own
   * `normalizedMatchVariations` to find its buckets, so the cost is
   * proportional to that item's variation count rather than to the index.
   */
  removeItem(mediaType: MediaType, externalId: string): void {
    const key = `${mediaType}:${externalId}`;
    const item = this.byExternalId.get(key);
    if (!item) return;
    this.byExternalId.delete(key);
    if (item.imdbId && this.byImdbId.get(item.imdbId) === item) {
      this.byImdbId.delete(item.imdbId);
    }
    for (const norm of item.normalizedMatchVariations) {
      const prefix = `${mediaType}:${norm.slice(0, 5)}`;
      const bucket = this.byTitlePrefix.get(prefix);
      if (!bucket) continue;
      const filtered = bucket.filter((it) => it !== item);
      if (filtered.length === 0) this.byTitlePrefix.delete(prefix);
      else if (filtered.length !== bucket.length) this.byTitlePrefix.set(prefix, filtered);
    }
  }

  removeItemsForInstance(instanceId: string): void {
    for (const [key, item] of this.byExternalId) {
      if (item.arrInstanceId === instanceId) this.byExternalId.delete(key);
    }
    for (const [imdbId, item] of this.byImdbId) {
      if (item.arrInstanceId === instanceId) this.byImdbId.delete(imdbId);
    }
    for (const [prefix, bucket] of this.byTitlePrefix) {
      const filtered = bucket.filter((it) => it.arrInstanceId !== instanceId);
      if (filtered.length !== bucket.length) {
        this.byTitlePrefix.set(prefix, filtered);
      }
    }
  }

  clear(): void {
    this.byExternalId.clear();
    this.byImdbId.clear();
    this.byTitlePrefix.clear();
  }

  getByExternalId(type: MediaType, externalId: string): CachedSearchItem | null {
    return this.byExternalId.get(`${type}:${externalId}`) ?? null;
  }

  getByImdbId(imdbId: string): CachedSearchItem | null {
    return this.byImdbId.get(imdbId) ?? null;
  }

  findByTitle(
    type: MediaType,
    releaseTitle: string,
    pack: LanguagePack,
    resolveOptions: ResolveInstanceOptions,
  ): CachedSearchItem | null {
    const cleanTitle = getCleanTitle(releaseTitle, pack);
    const norm = normalizeForComparison(cleanTitle, pack);
    const prefix = `${type}:${norm.slice(0, 5)}`;
    const bucket = this.byTitlePrefix.get(prefix);
    if (!bucket) return null;

    // Year tokens in the original (un-normalized) release title.
    // Disambiguates franchise overlap (e.g. a Formula-1 race recording many
    // years off vs. the 2025 "F1 - Der Film"); operators can disable
    // year-matching per instance if their library years are unreliable.
    const releaseYears = extractReleaseYears(releaseTitle);

    let best: CachedSearchItem | null = null;
    let bestLen = 0;
    for (const item of bucket) {
      if (!passesYearGate(item, releaseYears, resolveOptions)) continue;
      const matchLen = bestVariationMatchLen(item, cleanTitle, norm, pack, bestLen);
      if (matchLen > bestLen) {
        bestLen = matchLen;
        best = item;
      }
    }
    return best;
  }
}

// Returns true when the item's release year is compatible with the years
// mentioned in the release title (or when the gate doesn't apply). The gate
// only kicks in when the candidate item has a known year AND the release
// names at least one year AND the instance has year-matching on.
function passesYearGate(
  item: CachedSearchItem,
  releaseYears: number[],
  resolveOptions: ResolveInstanceOptions,
): boolean {
  if (item.year == null || releaseYears.length === 0) return true;
  const opts = resolveOptions(item.arrInstanceId);
  if (!opts.enableYearMatching) return true;
  const itemYear = item.year;
  const tol = opts.yearMatchingTolerance;
  return releaseYears.some((y) => Math.abs(y - itemYear) <= tol);
}

// Length of the longest match contributed by this item's variations, strictly
// greater than `minLen`, or 0 when none qualifies. Mirrors the boundary check
// in renameForMoviesAndTv so e.g. "Mike Renko 2" doesn't spuriously
// prefix-match "Mike Renko 2016".
function bestVariationMatchLen(
  item: CachedSearchItem,
  cleanTitle: string,
  norm: string,
  pack: LanguagePack,
  minLen: number,
): number {
  let bestLen = 0;
  for (const variationNorm of item.normalizedMatchVariations) {
    if (variationNorm.length === 0) continue;
    if (variationNorm.length <= minLen) continue;
    if (variationNorm.length <= bestLen) continue;
    if (!norm.startsWith(variationNorm)) continue;
    const endIdx = mapNormalizedLengthToOriginal(cleanTitle, variationNorm.length, pack);
    const nextChar = cleanTitle[endIdx];
    if (nextChar !== undefined && /[A-Za-z0-9]/.test(nextChar)) continue;
    bestLen = variationNorm.length;
  }
  return bestLen;
}
