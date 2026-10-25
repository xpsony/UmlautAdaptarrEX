import type { IndexerListEntry, IndexerSwitches } from "@/schemas/indexer-setting";

export interface HistoryHost {
  domain: string;
  lastSearchAt: Date | null;
}

export interface ProwlarrHost {
  host: string;
  name: string;
}

export interface IndexerSettingRow extends IndexerSwitches {
  host: string;
}

/**
 * One entry per host from three sources: hosts searched through (history),
 * Prowlarr's indexers (names) and hosts with a custom row. A host with a row
 * stays listed after it dropped out of the history retention.
 */
export function mergeIndexerList(
  history: readonly HistoryHost[],
  prowlarr: readonly ProwlarrHost[],
  rows: readonly IndexerSettingRow[],
): IndexerListEntry[] {
  const byHost = new Map<string, IndexerListEntry>();
  const entry = (host: string): IndexerListEntry => {
    const key = host.toLowerCase();
    let e = byHost.get(key);
    if (!e) {
      e = { host: key, name: null, lastSearchAt: null, custom: null };
      byHost.set(key, e);
    }
    return e;
  };
  for (const h of history) {
    if (!h.lastSearchAt) continue;
    const e = entry(h.domain);
    // History groups by the stored spelling, so one host can appear twice in
    // different case; keep the latest search.
    const iso = h.lastSearchAt.toISOString();
    if (!e.lastSearchAt || iso > e.lastSearchAt) e.lastSearchAt = iso;
  }
  for (const p of prowlarr) entry(p.host).name = p.name;
  for (const r of rows) {
    entry(r.host).custom = { tv: r.tv, movie: r.movie, audio: r.audio, book: r.book };
  }
  return Array.from(byHost.values()).sort((a, b) =>
    (a.name ?? a.host).localeCompare(b.name ?? b.host),
  );
}
