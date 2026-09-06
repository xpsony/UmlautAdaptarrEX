// Parses the `TRUST_PROXY` env var into a Fastify-compatible value.
//   - Unset / empty            → `false` (don't trust X-Forwarded-* at all)
//   - "true"                   → `true`  (trust any hop; opt-in for trusted networks only)
//   - "loopback"               → built-in shorthand
//   - comma-separated CIDRs/IPs → trust list (e.g. "127.0.0.1,::1,10.0.0.0/8")
//   - integer                  → REMOVED, see `isHopCountTrustProxy` below
//
// Default is `loopback` - safe baseline that trusts XFF only when the request
// arrived via 127.0.0.1/::1, blocking external XFF spoofing while still working
// behind a same-host reverse proxy. Override via env when fronted by an
// external proxy (e.g. Traefik on a different IP).
export type TrustProxyValue = boolean | string | string[];

/**
 * True when the raw env value uses the hop-count form (`TRUST_PROXY=1`).
 *
 * Fastify 5.12 disabled hop-count trust: it cannot validate the immediate
 * peer, so a client reaching the origin directly can spoof `X-Forwarded-*`
 * by padding enough hops. Fastify now fails closed for numbers, and its
 * option type no longer accepts one. `parseTrustProxy` mirrors that by
 * returning `false`; callers use this predicate to warn the operator that
 * their configured value is being ignored.
 */
export function isHopCountTrustProxy(raw: string | undefined): boolean {
  return /^\d+$/.test((raw ?? "").trim());
}

export function parseTrustProxy(raw: string | undefined): TrustProxyValue {
  const value = (raw ?? "loopback").trim();
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  // Hop counts are no longer honored (see isHopCountTrustProxy). Fail closed
  // rather than silently widening to `true` or narrowing to `loopback`.
  if (isHopCountTrustProxy(value)) return false;
  if (value.includes(",")) {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return value;
}
