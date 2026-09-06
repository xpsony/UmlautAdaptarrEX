/**
 * Presentational grouping for the rename-history table: collapse consecutive
 * rows with an identical (mediaType, originalTitle, rewrittenTitle) triple
 * into one display row with a counter and time range. Operates on the loaded
 * page only - a run may split across a page boundary, and totals/CSV keep
 * counting raw rows (accepted trade-off, see the design spec).
 */

interface GroupableRename {
  mediaType: string;
  originalTitle: string;
  rewrittenTitle: string;
  createdAt: string;
}

export interface RenameGroup<T> {
  /** First row of the run in delivered order (= newest under the default createdAt desc sort). */
  item: T;
  count: number;
  /** Oldest createdAt in the run (ISO string as delivered by the API). */
  firstAt: string;
  /** Newest createdAt in the run. */
  lastAt: string;
}

export function groupConsecutiveRenames<T extends GroupableRename>(items: T[]): RenameGroup<T>[] {
  const groups: RenameGroup<T>[] = [];
  for (const item of items) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.item.mediaType === item.mediaType &&
      prev.item.originalTitle === item.originalTitle &&
      prev.item.rewrittenTitle === item.rewrittenTitle
    ) {
      prev.count += 1;
      const ts = new Date(item.createdAt).getTime();
      if (ts < new Date(prev.firstAt).getTime()) prev.firstAt = item.createdAt;
      if (ts > new Date(prev.lastAt).getTime()) prev.lastAt = item.createdAt;
    } else {
      groups.push({ item, count: 1, firstAt: item.createdAt, lastAt: item.createdAt });
    }
  }
  return groups;
}
