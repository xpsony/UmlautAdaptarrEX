import type { z } from "zod";
import type { ArrInstanceInput, ArrInstanceSchema, ArrType, ProviderId } from "@/schemas/instance";

export type ArrInstanceFormInput = z.input<typeof ArrInstanceSchema>;

export interface Instance extends ArrInstanceInput {
  id: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/** Result shape of both `POST /api/admin/instances/test` and the per-instance
 * `POST /api/admin/instances/:id/test` - mirrors `TestConnectionResult` from
 * `src/arr/test-connection.ts` without importing that server-only module into
 * client bundles. */
export interface TestConnectionResponse {
  ok: boolean;
  version?: string;
  error?: string;
}

export const ARR_TYPES = ["sonarr", "radarr", "lidarr", "readarr"] as const;
export const PROVIDER_IDS = ["pcjones", "tvdb", "tmdb"] as const;

/**
 * Default provider order per Arr type.
 *  - Sonarr: pcjones first (DE specialist), then TVDB (TVDB ids without a
 *    resolve step), TMDB as catch-all.
 *  - Radarr: TMDB first (Radarr returns TMDB ids natively, no resolve step
 *    needed), TVDB as backup. pcjones is not in the default because the
 *    provider does not support movies.
 *  - Lidarr/Readarr: no TitleProvider; the field stays `null`.
 */
export const DEFAULT_PROVIDER_ORDER: Record<ArrType, ProviderId[] | null> = {
  sonarr: ["pcjones", "tvdb", "tmdb"],
  radarr: ["tmdb", "tvdb"],
  lidarr: null,
  readarr: null,
};

export function needsProviderOrder(type: ArrType): boolean {
  return type === "sonarr" || type === "radarr";
}
