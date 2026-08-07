import type { z } from "zod";
import type { UseFormReturn } from "react-hook-form";
import { SettingsUpdateSchema } from "@/schemas/settings";
import type { SettingsUpdate } from "@/schemas/settings";
import type { OperationMode } from "@/components/operation-mode-picker";

// Per-tab field subsets of SettingsUpdateSchema (Epic 6 / Task 7): the
// settings form was split into one RHF instance per tab so a dirty edit in
// tab A no longer keeps tab B's Save button enabled, and each Save only PUTs
// the fields that tab actually owns. `SettingsUpdateSchema` is already
// `SettingsSchema.partial()`, so every field here stays optional and a
// partial PUT is a no-op change on the server.
export const GeneralSettingsSchema = SettingsUpdateSchema.pick({
  proxyUsername: true,
  proxyPassword: true,
});
export const ProvidersSettingsSchema = SettingsUpdateSchema.pick({
  titleApiHost: true,
  tmdbApiKey: true,
  tvdbApiKey: true,
  tvdbPin: true,
});
// operationMode is intentionally excluded — OperationModeCard owns its own
// save path (a dedicated PUT of just `{ operationMode }`), independent of
// the Advanced form.
export const AdvancedSettingsSchema = SettingsUpdateSchema.pick({
  proxyPort: true,
  cacheDurationMinutes: true,
  indexerRateLimitMs: true,
  indexerTimeoutSeconds: true,
  userAgent: true,
  logRetentionDays: true,
  historyRetentionDays: true,
  blockPrivateInstanceHosts: true,
});

export type GeneralFormInput = z.input<typeof GeneralSettingsSchema>;
export type GeneralFormOutput = z.infer<typeof GeneralSettingsSchema>;
export type GeneralForm = UseFormReturn<GeneralFormInput, unknown, GeneralFormOutput>;

export type ProvidersFormInput = z.input<typeof ProvidersSettingsSchema>;
export type ProvidersFormOutput = z.infer<typeof ProvidersSettingsSchema>;
export type ProvidersForm = UseFormReturn<ProvidersFormInput, unknown, ProvidersFormOutput>;

export type AdvancedFormInput = z.input<typeof AdvancedSettingsSchema>;
export type AdvancedFormOutput = z.infer<typeof AdvancedSettingsSchema>;
export type AdvancedForm = UseFormReturn<AdvancedFormInput, unknown, AdvancedFormOutput>;

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
