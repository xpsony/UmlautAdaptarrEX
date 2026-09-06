import type { z } from "zod";
import type { UseFormReturn } from "react-hook-form";
import { SettingsSchema, SettingsUpdateSchema } from "@/schemas/settings";
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
// operationMode is intentionally excluded - OperationModeCard owns its own
// save path (a dedicated PUT of just `{ operationMode }`), independent of
// the Advanced form.
export const AdvancedSettingsSchema = SettingsUpdateSchema.pick({
  proxyPort: true,
  cacheDurationMinutes: true,
  indexerRateLimitMs: true,
  indexerTimeoutSeconds: true,
  userAgent: true,
  forwardArrUserAgent: true,
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

export const RenamingSettingsSchema = SettingsUpdateSchema.pick({
  renameYearGuard: true,
  renamePrefixGuard: true,
  renameReleaseTagGuard: true,
  renameLegacySuffix: true,
  renameStripSpecialChars: true,
  renameAttachExternalIds: true,
});

export type AdvancedFormInput = z.input<typeof AdvancedSettingsSchema>;
export type AdvancedFormOutput = z.infer<typeof AdvancedSettingsSchema>;
export type AdvancedForm = UseFormReturn<AdvancedFormInput, unknown, AdvancedFormOutput>;

export const SearchSettingsSchema = SettingsUpdateSchema.pick({
  onDemandLookup: true,
  tvVariationSearch: true,
  movieVariationSearch: true,
  maxTitleVariations: true,
  syncIntervalMinutes: true,
  fullSyncIntervalHours: true,
});

export type SearchFormInput = z.input<typeof SearchSettingsSchema>;
export type SearchFormOutput = z.infer<typeof SearchSettingsSchema>;
export type SearchForm = UseFormReturn<SearchFormInput, unknown, SearchFormOutput>;

/**
 * The six search fields with every value present. `SearchFormOutput` comes
 * from a partial schema, so its fields are optional; the UI needs a shape
 * where they are not, and both the settings tab and the setup wizard render
 * against this one.
 */
export interface SearchBehaviourValues {
  onDemandLookup: boolean;
  tvVariationSearch: boolean;
  movieVariationSearch: boolean;
  maxTitleVariations: number;
  syncIntervalMinutes: number;
  fullSyncIntervalHours: number;
}

/**
 * The fresh-install values for the six search fields, used as placeholders
 * until the settings query resolves. Derived from `SettingsSchema` rather
 * than restated, so the UI can never drift from the server defaults.
 */
export const SEARCH_DEFAULTS: SearchBehaviourValues = (() => {
  const full = SettingsSchema.parse({});
  return {
    onDemandLookup: full.onDemandLookup,
    tvVariationSearch: full.tvVariationSearch,
    movieVariationSearch: full.movieVariationSearch,
    maxTitleVariations: full.maxTitleVariations,
    syncIntervalMinutes: full.syncIntervalMinutes,
    fullSyncIntervalHours: full.fullSyncIntervalHours,
  };
})();

/** The two fan-out toggles, in the order the UI renders them. */
export const VARIATION_TOGGLES = [
  "tvVariationSearch",
  "movieVariationSearch",
] as const satisfies ReadonlyArray<keyof SearchFormOutput>;

export type VariationToggle = (typeof VARIATION_TOGGLES)[number];

/**
 * The worked example for the fan-out toggles: which extra queries actually go
 * out. Invented titles, like RENAMING_EXAMPLES, and pinned against
 * `generateForTvMovie` by `tests/unit/variation-examples.test.ts`.
 *
 * The German title deliberately carries umlauts: without them the generator
 * produces a single variation and the example would not show what the feature
 * is for.
 *
 * Not translated: a search query is data, not prose, and one copy means de/en
 * can never disagree about what the code does.
 */
export const VARIATION_EXAMPLE = {
  expectedTitle: "Roof Street",
  germanTitle: "Straße der Dächer",
  /** The literal query Sonarr sends. */
  query: "Roof Street S02E01",
  /** Extra queries the fan-out adds, in generator order. */
  variations: ["Straße der Dächer", "Strasse der Daecher", "Strasse der Dacher"],
} as const;

export type RenamingFormInput = z.input<typeof RenamingSettingsSchema>;
export type RenamingFormOutput = z.infer<typeof RenamingSettingsSchema>;
export type RenamingForm = UseFormReturn<RenamingFormInput, unknown, RenamingFormOutput>;

/** The toggle fields, in the order the Renaming tab renders them. */
export const RENAMING_TOGGLES = [
  "renameStripSpecialChars",
  "renameAttachExternalIds",
  "renameYearGuard",
  "renamePrefixGuard",
  "renameReleaseTagGuard",
  "renameLegacySuffix",
] as const satisfies ReadonlyArray<keyof RenamingFormOutput>;

export type RenamingToggle = (typeof RENAMING_TOGGLES)[number];

/**
 * A worked before/after example per toggle, so the switch is understandable
 * without reading the changelog.
 *
 * The release names are invented, and the `off`/`on` strings are the actual
 * output of the domain functions for the given input - they are pinned by
 * `tests/unit/renaming-examples.test.ts`, which runs each example through
 * `renameForMoviesAndTv` and fails if the copy ever drifts from the code.
 *
 * Not translated on purpose: a release name is not prose, and keeping one
 * copy means de/en can never disagree about what the code does. Only the
 * surrounding labels come from the message catalogue.
 */
export interface RenamingExample {
  /** The release name as the indexer delivers it. */
  input: string;
  /** Library context, when the example only makes sense with it. */
  item?: string;
  /** Output with the toggle off - `null` renders as "not renamed". */
  off: string | null;
  /** Output with the toggle on - `null` renders as "not renamed". */
  on: string | null;
  /** Extra one-line caveat rendered under the example, if any. */
  noteKey?: string;
}

export const RENAMING_EXAMPLES: Record<RenamingToggle, RenamingExample> = {
  renameStripSpecialChars: {
    input: "Ember.Stahlengel.2019.GERMAN.1080p.BluRay.x264-GRP",
    item: "Ember: Steel Angel",
    off: "Ember:.Steel.Angel.2019.GERMAN.1080p.BluRay.x264-GRP",
    on: "Ember.Steel.Angel.2019.GERMAN.1080p.BluRay.x264-GRP",
  },
  renameAttachExternalIds: {
    input: "Ember.Stahlengel.2019.GERMAN.1080p",
    item: "Ember: Steel Angel - tmdbid 800003, imdb tt7654322",
    // The title comes out identical either way, so it is elided (`…`) to keep
    // the line readable - what this toggle changes is the two attributes.
    off: "<item><title>…</title></item>",
    on:
      "<item><title>…</title>\n" +
      '  <newznab:attr name="tmdbid" value="800003"/>\n' +
      '  <newznab:attr name="imdb" value="7654322"/>\n' +
      "</item>",
    noteKey: "exampleNoteExternalIds",
  },
  renameYearGuard: {
    input: "Grand.Prix.2019.GERMAN.1080p.WEB-DL.x264-GRP",
    item: 'GP - Der Film (2025), Alias "Grand Prix"',
    off: "GP.-.Der.Film.2019.GERMAN.1080p.WEB-DL.x264-GRP",
    on: null,
  },
  renamePrefixGuard: {
    input: "Silberlicht.GERMAN.1080p.WEB.h264-GRP",
    item: 'Silberlicht: Ende der Reise, Alias "Silberlicht"',
    off: "Silberlicht:.Ende.der.Reise.GERMAN.1080p.WEB.h264-GRP",
    on: null,
    noteKey: "exampleNotePrefixGuard",
  },
  renameReleaseTagGuard: {
    input: "Nachtwache.Wiederkehr.3D.2010.GERMAN.1080p-GRP",
    item: 'Nightwatch Reborn, Alias "Nachtwache Wiederkehr 3D"',
    off: "Nightwatch.Reborn.2010.GERMAN.1080p-GRP",
    on: "Nightwatch.Reborn.3D.2010.GERMAN.1080p-GRP",
  },
  renameLegacySuffix: {
    input: "Renko.Jagd.2016.GERMAN.DL.1080p",
    item: 'Die Renko Jagd, Alias "Renko Jagd 2"',
    off: null,
    on: "Die.Renko.Jagd.016.GERMAN.DL.1080p",
    noteKey: "exampleNoteLegacySuffix",
  },
};

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
  // What a blank `userAgent` override resolves to (`UmlautAdaptarrEX/<version>`).
  // Display-only; rendered as the field's placeholder.
  defaultUserAgent?: string;
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
