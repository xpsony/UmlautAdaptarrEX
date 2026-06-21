import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@/lib/db";
import { getAppState } from "@/server/state";
import { isPrivateHost } from "@/server/security/ssrf";
import { redactApiKey } from "@/lib/log-redact";

export interface LegacyContext {
  apiKey: string;
  domain: string;
  search: string;
}

export type LegacyParseError =
  | "missing_api_key"
  | "missing_target"
  | "invalid_target"
  | "private_target";

const VALID_DOMAIN = /^[a-zA-Z0-9.\-]+(:\d+)?(\/.*)?$/;

// Localhost callers come in as IPv6 loopback under Node, so accept both.
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackRequest(req: FastifyRequest): boolean {
  return LOOPBACK_IPS.has(req.ip);
}

export function parseLegacyParams(
  req: FastifyRequest,
): LegacyContext | { error: LegacyParseError } {
  const params = req.params as { apiKey?: string; "*"?: string };
  const apiKey = params.apiKey;
  const wildcard = params["*"] ?? "";
  if (!apiKey) return { error: "missing_api_key" };
  if (!wildcard) return { error: "missing_target" };
  const hostPart = wildcard.split("/")[0] ?? "";
  if (!VALID_DOMAIN.test(hostPart)) {
    return { error: "invalid_target" };
  }
  // SSRF guard: an authenticated caller (or one that knows the appApiKey)
  // could otherwise turn this into a generic open proxy against internal
  // hosts. Block loopback, link-local, and the standard private ranges
  // unless the request itself originated on the loopback interface (the
  // co-hosted HTTP-proxy on :5006 dispatches to 127.0.0.1).
  if (!isLoopbackRequest(req) && isPrivateHost(hostPart)) {
    return { error: "private_target" };
  }
  const search = req.url.split("?", 2)[1] ?? "";
  return { apiKey, domain: wildcard, search };
}

export function isLegacyContext(
  v: LegacyContext | { error: LegacyParseError },
): v is LegacyContext {
  return !("error" in v);
}

// Constant-time comparison of two opaque strings. Length mismatch returns
// false without timing leakage about the expected length, since `provided`
// is hashed to a fixed-size buffer first.
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Compare against itself to spend constant time even on length mismatch.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function isApiKeyValid(
  provided: string,
  opts: { fromLoopback?: boolean } = {},
): boolean {
  const expected = getAppState().settings.appApiKey;
  // Legacy behavior (byte-compatible with the .NET predecessor and covered by
  // an explicit unit test): an empty/unset appApiKey means "no auth configured"
  // and grants open access. This is intentional wire-compat, NOT an oversight —
  // changing it to fail-closed is a deliberate product decision that belongs in
  // an explicit opt-in setting, not a silent default flip. See SECURITY notes.
  if (!expected) return true;
  // The "_" sentinel is used by the co-hosted HTTP-proxy on :5006 when no
  // appApiKey is configured. Accept it ONLY for loopback callers — never
  // from the public network, where it would otherwise be a free auth bypass.
  if (provided === "_") return opts.fromLoopback === true;
  return constantTimeEquals(provided, expected);
}

/**
 * Single entry-guard for legacy routes (caps + search). On failure it logs,
 * sends the appropriate error response, and returns null. SRP: validation +
 * uniform error replies live here so route handlers stay focused on their
 * specific work.
 */
export function assertLegacyContext(
  req: FastifyRequest,
  reply: FastifyReply,
  route: string,
): LegacyContext | null {
  const parsed = parseLegacyParams(req);
  if (!isLegacyContext(parsed)) {
    req.log.warn(
      {
        route,
        reason: parsed.error,
        // Mask the apiKey path segment + any apikey query param before
        // logging, otherwise the user's appApiKey lands in the log on every
        // malformed request.
        url: redactApiKey(req.url),
        ip: req.ip,
        ua: req.headers["user-agent"] ?? null,
      },
      "legacy request rejected: invalid request",
    );
    reply.code(400).send("Invalid request");
    return null;
  }
  if (!isApiKeyValid(parsed.apiKey, { fromLoopback: isLoopbackRequest(req) })) {
    req.log.warn(
      {
        route,
        domain: parsed.domain,
        apiKeyTail: parsed.apiKey.slice(-6),
        ip: req.ip,
      },
      "legacy request rejected: api key mismatch",
    );
    reply.code(403).send("Forbidden");
    return null;
  }
  return parsed;
}

export async function recordRequest(
  params: {
    apiKey: string;
    domain: string;
    type: string;
    query: string | null;
    externalId: string | null;
    status: number;
    durationMs: number;
    cacheHit: boolean;
  },
  req?: FastifyRequest,
): Promise<void> {
  try {
    const apiKeyTail = params.apiKey.slice(-6);
    // `domain` and `query` derive from the attacker-controllable request path,
    // so cap both before persisting to avoid storing unbounded blobs.
    const MAX_FIELD_LEN = 255;
    const domain = params.domain.split("/")[0]!.slice(0, MAX_FIELD_LEN);
    const query = params.query === null ? null : params.query.slice(0, MAX_FIELD_LEN);
    await prisma.requestHistory.create({
      data: {
        apiKey: apiKeyTail,
        domain,
        type: params.type,
        query,
        externalId: params.externalId,
        status: params.status,
        durationMs: params.durationMs,
        cacheHit: params.cacheHit,
      },
    });
  } catch (err) {
    // Best-effort write — request itself already responded — but a persistent
    // failure here means the History UI is silently broken; surface at debug.
    req?.log.debug(
      { err, type: params.type, domain: params.domain },
      "requestHistory insert failed",
    );
  }
}

export function buildIndexerUrl(ctx: LegacyContext): string {
  // ctx.domain already contains host + optional /api/... path (Prowlarr calls
  // /:apiKey/:host/api?...), so don't append the path twice. Indexers are
  // queried over HTTPS to match the legacy .NET behavior (UriBuilder("https",
  // domain) in UrlUtilities.cs); plain HTTP often gets 301-redirected and
  // some indexers refuse it outright. The redirect-following dispatcher in
  // indexer-fetcher.ts handles the rare HTTPS→HTTP edge case.
  const search = ctx.search ? `?${ctx.search}` : "";
  return `https://${ctx.domain}${search}`;
}

// Newznab/Torznab ID parameters that bypass the `q` text search. Old
// SearchControllerBase.BaseSearch removes these before issuing the German
// title-variation queries — otherwise the indexer ignores `q` entirely.
const ID_QUERY_PARAMS = ["tvdbid", "tvmazeid", "imdbid", "rid", "tmdbid"];

export function buildVariationSearch(search: string, q: string): string {
  const params = new URLSearchParams(search);
  for (const id of ID_QUERY_PARAMS) params.delete(id);
  params.set("q", q);
  return params.toString();
}
