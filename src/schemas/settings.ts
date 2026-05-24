import { z } from "zod";
import { isMaskedSecret } from "@/lib/secrets";

// Controls which components are active:
//   "proxy"  -> only the HTTP proxy on 5006; legacy routes on 5005 reply
//               with 503 + hint text.
//   "legacy" -> only the legacy routes on 5005; port 5006 runs as a mini
//               TCP stub that answers every connection with a hint text.
//   "both"   -> both active (1.x behaviour; default for existing installs).
export const OperationModeSchema = z.enum(["proxy", "legacy", "both"]);
export type OperationMode = z.infer<typeof OperationModeSchema>;

// Empty form input maps to `null` so leaving the field blank disables the
// TMDB provider on the next `reloadSettings`. Masked echoes (the bullet
// string the GET returns to indicate "secret is stored") map to `undefined`
// so a round-trip save leaves the stored secret intact.
const optionalSecret = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const trimmed = v.trim();
    if (trimmed === "") return null;
    if (isMaskedSecret(trimmed)) return undefined;
    return v;
  }, z.string().min(1).max(256).nullable())
  .optional();

// Empty password keeps the stored value (the UI shows the current one in
// plain text — submitting the form unchanged shouldn't wipe it). Therefore
// we treat "" as "leave it alone" in the admin route, not as a value to save.
const proxyPasswordInput = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(8).max(128),
  )
  .optional();

const SettingsSchema = z.object({
  proxyPort: z.number().int().min(1024).max(65535).default(5006),
  proxyUsername: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^:\s]+$/, {
      message: "Username may not contain colons or whitespace",
    })
    .default("UmlautAdaptarr"),
  proxyPassword: proxyPasswordInput,
  cacheDurationMinutes: z.number().int().min(1).max(1440).default(12),
  indexerRateLimitMs: z.number().int().min(0).max(60_000).default(500),
  // Pro-Indexer-Request-Timeout in Sekunden. Wird gleichzeitig auf connect,
  // headers und body angewendet (s. indexer-fetcher.ts). Mindestens 5 s, damit
  // langsame Indexer nicht sofort abgewuergt werden; Maximum 600 s, weil ein
  // Sonarr/Radarr-Search ohnehin nicht laenger blockiert sein sollte.
  indexerTimeoutSeconds: z.number().int().min(5).max(600).default(60),
  titleApiHost: z
    .string()
    .url()
    .default("https://umlautadaptarr.pcjones.de/api/v1"),
  tmdbApiKey: optionalSecret,
  // TVDB v4 API: key plus optional subscriber PIN. Some v4 endpoints
  // require the pin, so both are optional independently.
  tvdbApiKey: optionalSecret,
  tvdbPin: optionalSecret,
  userAgent: z.string().min(1).max(256).default("UmlautAdaptarrEX/2.0"),
  logRetentionDays: z.number().int().min(1).max(30).default(3),
  operationMode: OperationModeSchema.default("proxy"),
  // Strict SSRF mode for *Arr/Prowlarr hosts. Default false (self-hosted,
  // private/loopback allowed). Set to true for default-strict, which makes
  // sense for publicly reachable UmlautAdaptarrEX instances.
  blockPrivateInstanceHosts: z.boolean().default(false),
});

export const SettingsUpdateSchema = SettingsSchema.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

// Pause-Schalter (Header-Komponente). `durationMinutes = null` => unbegrenzte
// Pause (Sentinel-Datum Jahr 9999 wird serverseitig gesetzt). Range 1..1440 =
// 1 Minute bis 1 Tag, deckt die sechs Header-Optionen ab.
export const PauseRequestSchema = z.object({
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
});
export type PauseRequest = z.infer<typeof PauseRequestSchema>;
