import { z } from "zod";
import { VariationCapSchema } from "./settings";

/** Host and optional port, no path; the same rule as the legacy route target. */
export const IndexerHostSchema = z
  .string()
  .max(255)
  .regex(/^[a-zA-Z0-9.-]+(:\d+)?$/)
  .transform((h) => h.toLowerCase());

/** A custom indexer row: per media type a switch and a variation cap. */
export const IndexerVariationSettingSchema = z.object({
  tv: z.boolean(),
  movie: z.boolean(),
  audio: z.boolean(),
  book: z.boolean(),
  tvMax: VariationCapSchema,
  movieMax: VariationCapSchema,
  audioMax: VariationCapSchema,
  bookMax: VariationCapSchema,
});
export type IndexerVariationSetting = z.infer<typeof IndexerVariationSettingSchema>;

export interface IndexerListEntry {
  host: string;
  /** Prowlarr's indexer name when the host matches one, else null. */
  name: string | null;
  /** ISO timestamp of the latest search through this host, else null. */
  lastSearchAt: string | null;
  /** The custom setting, or null when the host follows the global one. */
  custom: IndexerVariationSetting | null;
}

export interface IndexerListResponse {
  indexers: IndexerListEntry[];
}
