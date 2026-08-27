import { z } from "zod";
import { ArrInstanceSchema } from "./instance";
import { OperationModeSchema } from "./settings";

export const SetupSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, {
      message: "Username may only contain letters, digits, _ . -",
    }),
  password: z.string().min(8).max(256),
  tmdbApiKey: z.string().max(256).optional().nullable(),
  /** Optional TVDB v4 API key. Empty/omitted leaves the field unset; the
   *  setup handler stores it on the singleton Setting row. */
  tvdbApiKey: z.string().max(256).optional().nullable(),
  /** Optional TVDB Subscriber-PIN. Only required for subscriber-only
   *  endpoints; standard keys work without one. */
  tvdbPin: z.string().max(64).optional().nullable(),
  /** How UmlautAdaptarr should run. Wizard default = "proxy" (recommended);
   *  migrations leave the DB default "both" in place. */
  operationMode: OperationModeSchema.optional(),
  /** Search-behaviour choices from the wizard's `search` step. All optional:
   *  a client that predates the step gets the recommended defaults, same
   *  policy as `operationMode`. */
  onDemandLookup: z.boolean().optional(),
  tvVariationSearch: z.boolean().optional(),
  movieVariationSearch: z.boolean().optional(),
  maxTitleVariations: z.number().int().min(1).max(20).optional(),
  syncIntervalMinutes: z
    .number()
    .int()
    .refine((v) => v === 0 || (v >= 5 && v <= 1440), {
      message: "0 disables the quick sync; otherwise 5-1440 minutes",
    })
    .optional(),
  fullSyncIntervalHours: z.number().int().min(1).max(168).optional(),
  /** Sonarr/Radarr/Lidarr/Readarr instances collected from Prowlarr in step 3. */
  prowlarrInstances: z.array(ArrInstanceSchema).optional(),
  /** HTTP-Proxy Basic-Auth credentials configured in step 4. */
  proxyUsername: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^:\s]+$/, {
      message: "Username may not contain colons or whitespace",
    }),
  proxyPassword: z.string().min(8).max(128),
  /** Optional: also push the proxy entry into the connected Prowlarr. */
  installProxyInProwlarr: z
    .object({
      host: z.string().trim().min(1).max(255),
    })
    .optional(),
  /** Built-in plugin enable-flags chosen in the wizard. Omitted entries fall
   * back to the plugin's `defaultEnabled` value via `seedPlugins()`. */
  plugins: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        enabled: z.boolean(),
      }),
    )
    .optional(),
});
export type SetupInput = z.infer<typeof SetupSchema>;

export const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  // Argon2 verify cost is constant w.r.t. input length, but pino-logging
  // and JSON parsing aren't - cap to avoid CPU/memory burn on a 5MB body.
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof LoginSchema>;
