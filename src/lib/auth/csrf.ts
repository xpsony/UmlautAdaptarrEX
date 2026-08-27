import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/db";

// `ua-csrf` is the JS-readable cookie the SPA copies into the
// `x-csrf-token` request header. The plugin's secret cookie (httpOnly,
// signed) is `_csrf` - that one stays inaccessible to JS.
export const CSRF_COOKIE = "ua-csrf";
export const CSRF_HEADER = "x-csrf-token";

let secret: Buffer | null = null;

// Loads the CSRF HMAC secret from the database (or `CSRF_SECRET` env override)
// and caches it for sync access from `getCsrfSecret`. On first boot the row
// is created and a fresh secret is persisted, so signed cookies stay valid
// across restarts and consistent between cluster workers.
//
// Must be called once at boot before any cookie/CSRF integration runs. The
// returned secret feeds two consumers:
//   - `@fastify/cookie` registration's `secret` (signs all signed cookies)
//   - `@fastify/csrf-protection` plugin (HMAC key when userInfo is enabled -
//     not currently used, but the same secret is reused so no second secret
//     needs to be persisted)
//
// Idempotent: if two workers race the create-path, the loser falls through
// to a re-read instead of crashing on a unique constraint. The stub row is
// created with a random `appApiKey` (not `""`) so the legacy-route
// "empty key = open access" branch is not silently triggered between boot
// and the user finishing the setup wizard.
// Minimum byte length for an externally-supplied CSRF secret. 32 bytes is
// the floor recommended for HMAC-SHA256 keys; anything shorter weakens
// the signed-cookie HMAC enough that we'd rather ignore the env var and
// fall back to the auto-generated DB-stored secret.
const MIN_CSRF_SECRET_BYTES = 32;

export async function ensureCsrfSecret(): Promise<void> {
  if (secret) return;
  const env = process.env.CSRF_SECRET;
  if (env) {
    const envBuf = Buffer.from(env, "utf8");
    if (envBuf.length < MIN_CSRF_SECRET_BYTES) {
      // Don't crash here - that would brick boot for anyone with a misset
      // env var. But we WARN loudly and refuse the value, so the
      // operator notices on next deploy and the secret-quality guarantee
      // isn't silently downgraded.
      console.warn(
        `[csrf] CSRF_SECRET env var is ${envBuf.length} bytes - must be at least ${MIN_CSRF_SECRET_BYTES} bytes; ignoring and falling back to the DB-stored secret.`,
      );
    } else {
      secret = envBuf;
      return;
    }
  }
  const existing = await prisma.setting.findUnique({
    where: { id: 1 },
    select: { csrfSecret: true },
  });
  if (existing?.csrfSecret) {
    secret = Buffer.from(existing.csrfSecret, "base64");
    return;
  }
  const fresh = randomBytes(32);
  const encoded = fresh.toString("base64");
  await prisma.setting.upsert({
    where: { id: 1 },
    create: { id: 1, appApiKey: nanoid(32), csrfSecret: encoded },
    update: { csrfSecret: encoded },
  });
  const after = await prisma.setting.findUnique({
    where: { id: 1 },
    select: { csrfSecret: true },
  });
  secret = after?.csrfSecret ? Buffer.from(after.csrfSecret, "base64") : fresh;
}

export function getCsrfSecret(): Buffer {
  if (!secret) {
    throw new Error(
      "CSRF secret not initialized - call ensureCsrfSecret() at boot first",
    );
  }
  return secret;
}

// Test-only: clears the cached secret so tests can re-initialize. Guarded so
// it can never be triggered from a production bundle by an accidental import.
export function _resetCsrfSecretForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "_resetCsrfSecretForTests must not be called in production",
    );
  }
  secret = null;
}
