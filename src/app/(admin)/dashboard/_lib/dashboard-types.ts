export interface Instance {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface SyncStartResponse {
  ok: true;
  runIds: string[];
  instanceCount: number;
}

export interface StatsResponse {
  summary: {
    requests24h: number;
    cacheHits24h: number;
    cacheHitRate: number;
    renames24h: number;
    renames14d: number;
  };
  requestsHourly: { ts: string; hit: number; miss: number }[];
  renamesDaily: { ts: string; count: number }[];
}

export interface ProwlarrConfig {
  host: string | null;
  configured: boolean;
}
