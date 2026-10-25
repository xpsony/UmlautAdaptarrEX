import type { RawArrItem } from "@/arr/raw-item";

/**
 * The stored columns the delta compares against. Kept as narrow as it can be:
 * a quick sync runs every few minutes, so it must not pull the JSON variation
 * columns for the whole library. `externalIdAliases` is the one JSON column
 * worth its width here, because for Listenarr it is the only column an *Arr
 * side series change touches, so leaving it out would make that change
 * invisible until the next full sync.
 */
export interface StoredDeltaKey {
  externalId: string;
  title: string;
  year: number | null;
  /**
   * Serialised alias list, exactly as `persistItems` writes it. Listenarr
   * derives this from the audiobook's series, which feeds neither title nor
   * year, so without comparing it a series change would be invisible to the
   * quick sync.
   */
  externalIdAliases: string | null;
}

/**
 * Serialises an alias list the way `persistItems` in `run.ts` writes the
 * column, so comparing the two serialised forms needs no parsing on the hot
 * path and a store/read round trip never looks like a change. Keep this in
 * step with that writer.
 */
function serialiseExternalIdAliases(aliases: readonly string[] | null | undefined): string | null {
  return aliases ? JSON.stringify(aliases) : null;
}

export interface DeltaPlan {
  /** New, or *Arr-side title/year/alias changed. Only these go through deriveItems. */
  changed: RawArrItem[];
  /** Stored rows the *Arr no longer lists. */
  removedExternalIds: string[];
  /** True when there is nothing to persist at all - the common case. */
  isEmpty: boolean;
}

/**
 * Diffs the *Arr's current listing against what we have stored.
 *
 * What this catches: additions, removals, *Arr-side renames (a corrected
 * title or year), and alias-list changes (a Listenarr audiobook joining or
 * leaving a series). What it does NOT catch: provider-side changes, e.g. a
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
    if (
      prior.title !== item.title ||
      prior.year !== item.year ||
      prior.externalIdAliases !== serialiseExternalIdAliases(item.externalIdAliases)
    ) {
      changed.push(item);
    }
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
