import { z } from "zod";
import { ArrInstanceSchema, type ArrTypeSchema } from "./instance";

export const ProwlarrCredsSchema = z.object({
  host: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), {
      message: "Host must start with http:// or https://",
    }),
  apiKey: z.string().min(8).max(128),
});
export type ProwlarrCredsInput = z.infer<typeof ProwlarrCredsSchema>;

export const ProwlarrImportSchema = z.object({
  selections: z.array(ArrInstanceSchema).min(1),
});

type ProwlarrSkipReason =
  "unsupported_type" | "missing_api_key" | "missing_host" | "masked_api_key";

export interface ProwlarrParsedApp {
  prowlarrId: number;
  type: z.infer<typeof ArrTypeSchema>;
  name: string;
  host: string;
  apiKey: string;
  syncLevel: string | null;
}

export interface ProwlarrSkippedApp {
  prowlarrId: number;
  name: string;
  implementation: string;
  reason: ProwlarrSkipReason;
}

export interface ProwlarrPreviewResult {
  apps: ProwlarrParsedApp[];
  skipped: ProwlarrSkippedApp[];
}

export const InstallProxySchema = z.object({
  host: z.string().trim().min(1).max(255),
});
export type InstallProxyInput = z.infer<typeof InstallProxySchema>;

export interface InstallProxyPreviewResponse {
  defaultHost: string;
  port: number;
  username: string;
  name: string;
  tagLabel: string;
  hasPassword: boolean;
  existing: { id: number } | null;
}

export interface InstallProxyResponse {
  ok: true;
  action: "created" | "updated";
  id: number;
  tagId: number;
}

// --- Indexer patching -------------------------------------------------------

// A single Prowlarr indexer as shown in the patch dialog. Carries no secrets:
// indexer-level API keys / cookies live in `fields` on the raw object and are
// never mapped into this view.
export type ProwlarrIndexerSkipReason = "no_base_url" | "unsupported_api";

export interface ProwlarrIndexerView {
  id: number;
  name: string;
  enable: boolean;
  protocol: string; // "torrent" | "usenet" | "unknown"
  /**
   * Prowlarr's own implementation name ("Newznab", "Torznab", "Cardigann", a
   * native tracker client, ...) or null when Prowlarr did not report one. The
   * dialog names it in the tooltip of an indexer it had to grey out.
   */
  implementation: string | null;
  currentBaseUrl: string | null;
  isPatched: boolean;
  patchable: boolean;
  reason?: ProwlarrIndexerSkipReason; // set when patchable === false
}

export interface ProwlarrIndexersResponse {
  indexers: ProwlarrIndexerView[];
  tagLabel: string;
}

// `selectedIds` is the DESIRED final selection (toggle semantics): indexers in
// the set are patched, indexers not in the set are un-patched. Capped to keep
// a malformed payload from fanning out into unbounded Prowlarr PUTs.
export const PatchIndexersSchema = z.object({
  selectedIds: z.array(z.number().int().nonnegative()).max(1000),
});
export type PatchIndexersInput = z.infer<typeof PatchIndexersSchema>;

export interface PatchIndexerResult {
  id: number;
  name: string;
  action: "patched" | "unpatched" | "unchanged" | "failed" | "skipped";
  error?: string;
}

export interface PatchIndexersResponse {
  results: PatchIndexerResult[];
}
