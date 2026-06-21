import type { z } from "zod";
import type { UseFormReturn } from "react-hook-form";
import type { SettingsUpdate, SettingsUpdateSchema } from "@/schemas/settings";
import type { OperationMode } from "@/components/operation-mode-picker";

export type SettingsFormInput = z.input<typeof SettingsUpdateSchema>;

export type SettingsForm = UseFormReturn<SettingsFormInput, unknown, SettingsUpdate>;

export interface SettingsRow extends SettingsUpdate {
  appApiKey: string;
  proxyUsername: string;
  proxyPassword: string;
  // True when UMLAUTADAPTARREX_PROXY_PORT pins the port; the UI shows the
  // effective value read-only because a save would not take effect.
  proxyPortEnvManaged?: boolean;
  // Resolved (env var or default) Fastify API and Web UI ports. Display-only:
  // they are not stored in the DB and only change via env var + restart.
  legacyApiPort?: number;
  webUiPort?: number;
  // Server-only "is the secret stored?" booleans. Returned alongside the
  // masked key fields so the UI can render a stored-state badge without
  // having access to the cleartext value.
  tmdbConfigured: boolean;
  tvdbConfigured: boolean;
  tvdbPinConfigured: boolean;
  prowlarrConfigured: boolean;
}

export interface ProwlarrConfigResponse {
  host: string | null;
  configured: boolean;
}

export interface TitleCacheStats {
  total: number;
  positive: number;
  negative: number;
}

export interface PluginEntry {
  id: string;
  nameKey: string;
  descriptionKey: string;
  language: string;
  enabled: boolean;
  defaultEnabled: boolean;
}

export type TmdbTestResult =
  | { ok: true; sample: { id: number; title: string } }
  | {
      ok: false;
      code: "missing" | "v4_token" | "invalid_format" | "unauthorized" | "network" | "unknown";
      detail?: string;
    };

export type TvdbTestResult =
  | { ok: true; sample: { id: number; title: string } }
  | {
      ok: false;
      code: "missing" | "unauthorized" | "network" | "unknown";
      detail?: string;
    };

export interface OperationModeResponse {
  operationMode?: OperationMode;
  // Resolved service ports (env override > DB/default) from /api/admin/settings,
  // shown in the mode picker and restart hints so the copy matches the actual
  // listeners.
  legacyApiPort?: number;
  proxyPort?: number;
}
