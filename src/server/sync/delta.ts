import type { RawArrItem } from "@/arr/raw-item";

/**
 * The stored columns the delta compares against. Deliberately the smallest
 * possible `select`: a quick sync runs every few minutes, so it must not pull
 * the JSON variation columns for the whole library.
 */
export interface StoredDeltaKey {
  externalId: string;
  title: string;
  year: number | null;
}

export interface DeltaPlan {
  /** New, or *Arr-side title/year changed. Only these go through deriveItems. */
  changed: RawArrItem[];
  /** Stored rows the *Arr no longer lists. */
  removedExternalIds: string[];
  /** True when there is nothing to persist at all - the common case. */
  isEmpty: boolean;
}

/**
 * Diffs the *Arr's current listing against what we have stored.
 *
 * What this catches: additions, removals, and *Arr-side renames (a corrected
 * title or year). What it does NOT catch: provider-side changes, e.g. a
 * German title appearing at pcjones for a title we already know. Those need
 * the full sync, which re-queries every provider. That split is the whole
 * point - it is what makes a 10-minute cadence affordable.
 */
export function planDelta(
  raw: readonly RawArrItem[],
  stored: readonly StoredDeltaKey[],
): DeltaPlan {
  const storedByExternalId = new Map(stored.map((s) => [s.externalId, s]));
  // Last-wins dedup, matching persistItems: the *Arr can report the same
  // externalId twice (two library entries pointing at one tvdbid).
  const rawByExternalId = new Map<string, RawArrItem>();
  for (const item of raw) rawByExternalId.set(item.externalId, item);

  const changed: RawArrItem[] = [];
  for (const [externalId, item] of rawByExternalId) {
    const prior = storedByExternalId.get(externalId);
    if (!prior) {
      changed.push(item);
      continue;
    }
    if (prior.title !== item.title || prior.year !== item.year) changed.push(item);
  }

  const removedExternalIds: string[] = [];
  for (const s of stored) {
    if (!rawByExternalId.has(s.externalId)) removedExternalIds.push(s.externalId);
  }

  return {
    changed,
    removedExternalIds,
    isEmpty: changed.length === 0 && removedExternalIds.length === 0,
  };
}
