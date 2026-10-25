import { z } from "zod";

/** Host and optional port, no path; the same rule as the legacy route target. */
export const IndexerHostSchema = z
  .string()
  .max(255)
  .regex(/^[a-zA-Z0-9.-]+(:\d+)?$/)
  .transform((h) => h.toLowerCase());

export const IndexerSwitchesSchema = z.object({
  tv: z.boolean(),
  movie: z.boolean(),
  audio: z.boolean(),
  book: z.boolean(),
});
export type IndexerSwitches = z.infer<typeof IndexerSwitchesSchema>;

export interface IndexerListEntry {
  host: string;
  /** Prowlarr's indexer name when the host matches one, else null. */
  name: string | null;
  /** ISO timestamp of the latest search through this host, else null. */
  lastSearchAt: string | null;
  /** The custom switches, or null when the host follows the global ones. */
  custom: IndexerSwitches | null;
}

export interface IndexerListResponse {
  indexers: IndexerListEntry[];
}
