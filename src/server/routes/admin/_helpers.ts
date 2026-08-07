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

/** Maps a public `sort` query value to the Prisma field name it orders by. */
export type SortWhitelist = Record<string, string>;

/**
 * Resolve `sort`/`order` query params against a per-endpoint whitelist.
 * Neither axis ever 400s: a `sort` key outside the whitelist falls back to
 * `defaultKey`, and an `order` that isn't literally "asc"/"desc" falls back
 * to `defaultOrder`. The two axes are resolved independently, so e.g. an
 * unknown sort key with a valid `order` still honors that order on the
 * default column.
 */
export function resolveSort(
  q: Record<string, string | undefined>,
  whitelist: SortWhitelist,
  defaultKey: string,
  defaultOrder: "asc" | "desc" = "desc",
): { field: string; order: "asc" | "desc" } {
  const field =
    q.sort !== undefined && Object.hasOwn(whitelist, q.sort)
      ? whitelist[q.sort]!
      : whitelist[defaultKey]!;
  const order: "asc" | "desc" = q.order === "asc" || q.order === "desc" ? q.order : defaultOrder;
  return { field, order };
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

// A string cell starting with one of these is interpreted as a formula by
// Excel/Sheets/LibreOffice on open (CSV/formula injection, CWE-1236) — the
// exported free-text columns (search queries, original/rewritten titles)
// ultimately trace back to *arr search terms / indexer release names, which
// an attacker can influence, so this can't be dismissed as "our own data".
// Leading tab is included per OWASP's CSV-injection character list, in
// addition to the classic =, +, -, @.
const FORMULA_PREFIX = /^[=+\-@\t]/;

/** Quote a single CSV cell per RFC 4180 when it needs it, else return it verbatim. */
function csvCell(value: unknown): string {
  let raw = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  // Only string-typed values get the anti-formula prefix: a leading `'`
  // would otherwise misrepresent legitimate negative numbers (e.g.
  // `durationMs`) as text in the spreadsheet. A leading apostrophe in a CSV
  // cell is the standard mitigation — Excel/Sheets render it as literal text
  // instead of evaluating the rest as a formula.
  if (typeof value === "string" && FORMULA_PREFIX.test(raw)) {
    raw = `'${raw}`;
  }
  return /["\n\r,]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/**
 * Render `rows` as RFC-4180 CSV text: a header row of `columns`, followed by
 * one row per item in the same column order. `null`/`undefined` cells become
 * empty, `Date` cells become their ISO-8601 string, everything else is
 * stringified. Cells containing `"`, `,`, `\n`, or `\r` are quoted (with `"`
 * doubled). A string cell starting with `=`, `+`, `-`, or `@` is prefixed
 * with `'` to defuse spreadsheet formula injection. Lines are joined with
 * `\r\n` (the RFC's line ending); no trailing line ending is appended.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\r\n");
}
