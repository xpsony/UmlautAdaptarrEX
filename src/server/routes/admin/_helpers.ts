import type { FastifyReply } from "fastify";
import type { ZodType } from "zod";

/**
 * Parse `body` against `schema`. On failure, sends a 400 with the standard
 * `{ error: "validation", issues }` shape and returns `null` so the caller can
 * `if (!data) return;` and exit cleanly.
 */
export function parseOrReply<T>(body: unknown, schema: ZodType<T>, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    reply.code(400).send({ error: "validation", issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}

/** Clamp a numeric query string into [min,max], falling back to `def`. */
export function clampInt(input: string | undefined, def: number, min: number, max: number): number {
  const n = input == null ? def : parseInt(input, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** True when `err` is a Prisma error with the given error code (e.g. "P2025"). */
export function isPrismaErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === code
  );
}

/**
 * Parse a JSON-array column, returning `null` on corrupt input instead of
 * throwing. Mirrors `parseAliasesJson` in `src/server/title-overrides/rebuild.ts`
 * — a single malformed row must degrade gracefully, not 500 an entire page.
 */
export function parseJsonArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}
