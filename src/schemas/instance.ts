import { z } from "zod";

export const ArrTypeSchema = z.enum(["sonarr", "radarr", "lidarr", "readarr", "listenarr"]);
export type ArrType = z.infer<typeof ArrTypeSchema>;

export const ProviderIdSchema = z.enum(["pcjones", "tvdb", "tmdb"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

// Ordered list of title providers consulted for an instance (in the given
// order). Only relevant for Sonarr/Radarr; Lidarr/Readarr/Listenarr set this field
// to `null` because their sync doesn't call the TitleProvider.
export const ProviderOrderSchema = z
  .array(ProviderIdSchema)
  .min(1)
  .max(3)
  .refine((arr) => new Set(arr).size === arr.length, {
    message: "Provider duplicates are not allowed",
  });

export type ProviderOrder = z.infer<typeof ProviderOrderSchema>;

// Year-Matching tolerance is constrained to a small range. Larger windows
// dilute the disambiguation power; smaller windows would equal the strict
// equality case (tolerance 0 disables the +/- skew absorption). Capped at 5
// because anything beyond that effectively defeats the purpose.
const YearToleranceSchema = z.number().int().min(0).max(5);

export const ArrInstanceSchema = z
  .object({
    type: ArrTypeSchema,
    name: z.string().min(1).max(64),
    host: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//i.test(v), {
        message: "Host must start with http:// or https://",
      }),
    apiKey: z.string().min(8).max(128),
    enabled: z.boolean().default(true),
    // Default is `null`; UI/setup wizard sets a sensible per-type value.
    // Lidarr/Readarr/Listenarr stay `null`; sync ignores the field for those types.
    providerOrder: ProviderOrderSchema.nullable().default(null),
    // Year-Disambiguation pro Instanz. Wirkt nur fuer Sonarr/Radarr; das
    // Backend liest die Felder dort beim Match-Aufbau aus. Lidarr/Readarr/Listenarr
    // ignorieren die Felder vollstaendig.
    enableYearMatching: z.boolean().default(true),
    yearMatchingTolerance: YearToleranceSchema.default(1),
  })
  .superRefine((data, ctx) => {
    const needsProvider = data.type === "sonarr" || data.type === "radarr";
    if (needsProvider && !data.providerOrder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerOrder"],
        message: "providerOrder is required for sonarr/radarr",
      });
    }
  });

export type ArrInstanceInput = z.infer<typeof ArrInstanceSchema>;

export const ArrInstanceUpdateSchema = z.object({
  id: z.string().min(1),
  type: ArrTypeSchema.optional(),
  name: z.string().min(1).max(64).optional(),
  host: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), {
      message: "Host must start with http:// or https://",
    })
    .optional(),
  apiKey: z.string().min(8).max(128).optional(),
  enabled: z.boolean().optional(),
  providerOrder: ProviderOrderSchema.nullable().optional(),
  enableYearMatching: z.boolean().optional(),
  yearMatchingTolerance: YearToleranceSchema.optional(),
});

export const TestConnectionSchema = z.object({
  type: ArrTypeSchema,
  host: z.string().url(),
  apiKey: z.string().min(1),
});
