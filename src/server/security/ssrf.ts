import { isIP } from "node:net";
import { getAppState } from "@/server/state";

// Hostnames or IP literals that should never be reachable through user-controlled
// proxies/legacy URLs. Blocks the obvious SSRF surfaces: loopback, link-local
// (cloud metadata!), and the standard private ranges. Operators that legitimately
// need to proxy a private host can override at the network/firewall layer.
const PRIVATE_IPV4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  cidr("0.0.0.0", 8),
  cidr("10.0.0.0", 8),
  cidr("100.64.0.0", 10), // CGN-NAT (also commonly internal)
  cidr("127.0.0.0", 8),
  cidr("169.254.0.0", 16), // link-local incl. cloud metadata 169.254.169.254
  cidr("172.16.0.0", 12),
  cidr("192.0.0.0", 24),
  cidr("192.168.0.0", 16),
  cidr("198.18.0.0", 15),
];

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "host.docker.internal",
  "gateway.docker.internal",
]);

// Hostnames whose suffix indicates a private/internal scope. Covers mDNS
// (`*.local`), classic intranet conventions (`*.internal`, `*.intranet`,
// `*.lan`, `*.corp`, `*.home`, `*.private`), and Kubernetes service DNS
// (`*.svc`, `*.cluster.local`).
const PRIVATE_SUFFIXES: ReadonlyArray<string> = [
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".corp",
  ".home",
  ".private",
  ".svc",
  ".cluster.local",
];

function cidr(ip: string, bits: number): readonly [number, number] {
  const num = strictDottedQuadToInt(ip);
  if (num === null) throw new Error(`bad CIDR seed: ${ip}`);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [num & mask, mask] as const;
}

// Strictly parses a dotted-quad IPv4 (each octet a base-10 integer 0..255).
// Rejects octal (`0177.0.0.1`), hex (`0x7f.0.0.1`), abbreviated forms
// (`127.1`), and decimal-encoded 32-bit literals (`2130706433`). All of those
// would otherwise round-trip through Node's resolver back to a private IP,
// silently bypassing our private-host check.
function strictDottedQuadToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) return null;
    // Disallow leading zeros (octal-style); a single "0" is allowed.
    if (part.length > 1 && part.startsWith("0")) return null;
    if (part.length > 3) return null;
    const n = parseInt(part, 10);
    if (Number.isNaN(n) || n < 0 || n > 255) return null;
    acc = (acc << 8) | n;
  }
  return acc >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const num = strictDottedQuadToInt(ip);
  if (num === null) return false;
  return PRIVATE_IPV4_CIDRS.some(([net, mask]) => (num & mask) === net);
}

// True for any ambiguous IPv4-shaped string Node can still resolve, but our
// strict parser cannot validate (decimal-32, octal, hex, short-form). Such
// hostnames are conservatively treated as private to plug DNS-resolver-quirk
// SSRF bypasses (`http://2130706433/` → 127.0.0.1, `http://0177.0.0.1/`,
// `http://127.1/`).
function isAmbiguousNumericHostname(hostname: string): boolean {
  if (!/^[0-9a-fxA-FX.]+$/.test(hostname)) return false;
  if (!/[0-9]/.test(hostname)) return false;
  // A strictly valid dotted-quad is handled by `isPrivateIpv4`. Anything
  // else that looks numeric but isn't a strict dotted-quad is suspicious.
  if (strictDottedQuadToInt(hostname) !== null) return false;
  // Decimal-only without dots (`2130706433`) - Node will resolve it.
  if (/^[0-9]+$/.test(hostname)) return true;
  // 0x-prefixed hex octets, leading-zero (octal) octets.
  if (/(^|\.)(0[xX][0-9a-fA-F]+|0[0-7]+)(\.|$)/.test(hostname)) return true;
  // Two or three-part dotted (`127.1`, `127.0.1`) - Node treats them as IPv4.
  const parts = hostname.split(".");
  if (parts.length >= 2 && parts.length <= 3) {
    if (parts.every((p) => /^[0-9]+$/.test(p))) return true;
  }
  return false;
}

// Expands an IPv6 literal into eight 4-hex-digit groups so subsequent
// prefix/exact matching is unambiguous. Handles `::` zero-elision *and*
// dotted-quad IPv4 in the last group (e.g. `::ffff:127.0.0.1`), which gets
// folded into two hex groups.
function expandIpv6(ip: string): string | null {
  const lower = ip.toLowerCase();
  let body = lower;
  let trailingV4: string | null = null;
  // If the last segment is a dotted-quad IPv4, fold it into two hex groups.
  const lastColon = body.lastIndexOf(":");
  if (lastColon >= 0 && body.slice(lastColon + 1).includes(".")) {
    const v4 = body.slice(lastColon + 1);
    const num = strictDottedQuadToInt(v4);
    if (num === null) return null;
    const hi = ((num >>> 16) & 0xffff).toString(16);
    const lo = (num & 0xffff).toString(16);
    body = `${body.slice(0, lastColon + 1)}${hi}:${lo}`;
    trailingV4 = v4;
  }
  let leftParts: string[];
  let rightParts: string[];
  if (body.includes("::")) {
    const [left, right] = body.split("::", 2) as [string, string];
    leftParts = left ? left.split(":") : [];
    rightParts = right ? right.split(":") : [];
  } else {
    leftParts = body.split(":");
    rightParts = [];
  }
  const total = leftParts.length + rightParts.length;
  if (total > 8) return null;
  const missing = 8 - total;
  if (!body.includes("::") && total !== 8) return null;
  const fill = Array<string>(missing).fill("0");
  const groups = [...leftParts, ...fill, ...rightParts];
  if (groups.length !== 8) return null;
  // Trailing dotted-quad gets re-attached for the IPv4-mapped check.
  const expanded = groups.map((p) => (p ? p : "0").padStart(4, "0")).join(":");
  return trailingV4 ? `${expanded}|v4=${trailingV4}` : expanded;
}

function isPrivateIpv6(ip: string): boolean {
  const raw = expandIpv6(ip);
  if (!raw) return false;
  const [expanded, v4Tag] = raw.split("|v4=", 2);
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return true; // ::1
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return true; // ::
  if (expanded!.startsWith("fe80:")) return true;
  const firstByte = parseInt(expanded!.slice(0, 2), 16);
  // fc00::/7 (Unique Local Addresses) - first byte 0xfc or 0xfd.
  if (!Number.isNaN(firstByte) && (firstByte & 0xfe) === 0xfc) return true;
  // IPv4-mapped IPv6 `::ffff:a.b.c.d`. Detect both via the dotted-quad tag
  // (preferred - preserves the original v4 form) and the all-hex form
  // `::ffff:7f00:1`.
  if (expanded!.startsWith("0000:0000:0000:0000:0000:ffff:")) {
    if (v4Tag) return isPrivateIpv4(v4Tag);
    const tail = expanded!.slice("0000:0000:0000:0000:0000:ffff:".length);
    const groups = tail.split(":");
    if (groups.length === 2) {
      const a = parseInt(groups[0]!, 16);
      const b = parseInt(groups[1]!, 16);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        const v4 = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
        return isPrivateIpv4(v4);
      }
    }
  }
  return false;
}

// Returns `true` when the given hostname (literal or IP) refers to a private,
// loopback, or link-local address. Hostnames that aren't IP literals are
// matched against a static blocklist plus a private-suffix list - DNS
// resolution is intentionally NOT performed here, since rebind attacks could
// change the result between check and connect. Operators concerned about
// DNS-rebind should put a forward proxy with explicit allow-listing in front
// of the app.
//
// The check is conservative: ambiguous numeric forms (decimal-32, octal,
// short-form IPv4) are rejected even when they don't strictly parse, because
// Node's DNS resolver still maps them to IPv4 at connect time.
export function isPrivateHost(host: string): boolean {
  if (!host) return false;
  let hostname = host.trim().toLowerCase();
  // Strip optional :port and bracketed IPv6 form.
  if (hostname.startsWith("[")) {
    const close = hostname.indexOf("]");
    if (close > 0) hostname = hostname.slice(1, close);
  } else {
    const colons = hostname.split(":").length - 1;
    // A single `:` is unambiguously `host:port`. Multiple colons indicate an
    // IPv6 literal (with or without `::`) that we keep intact.
    if (colons === 1) {
      const idx = hostname.lastIndexOf(":");
      if (idx > 0) hostname = hostname.slice(0, idx);
    }
  }
  // Reject FQDN trailing dots: `localhost.` resolves identical to `localhost`.
  while (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (!hostname) return false;
  if (PRIVATE_HOSTNAMES.has(hostname)) return true;
  for (const suffix of PRIVATE_SUFFIXES) {
    if (hostname === suffix.slice(1) || hostname.endsWith(suffix)) return true;
  }
  const kind = isIP(hostname);
  if (kind === 4) return isPrivateIpv4(hostname);
  if (kind === 6) return isPrivateIpv6(hostname);
  if (isAmbiguousNumericHostname(hostname)) return true;
  return false;
}

// Resolves whether a full URL string targets a private/internal host. Used by
// admin-callable endpoints (`testConnection`, `fetchProwlarrApplications`,
// indexer redirect-checking) where the user (or upstream) supplies a URL.
export function urlIsPrivate(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return isPrivateHost(u.hostname);
  } catch {
    // Unparseable URL - treat as private/blocked rather than risk a
    // misformatted SSRF target slipping through.
    return true;
  }
}

// Self-hosted installs almost always run UmlautAdaptarrEX alongside
// Sonarr/Radarr/Prowlarr on the same Docker host or LAN, so `testConnection`
// legitimately needs to talk to `localhost:8989`, `host.docker.internal`,
// `192.168.x.x`, etc. The default is therefore permissive - that is the common
// deployment shape for this app. Cloud-hosted UmlautAdaptarrEX instances
// (rare; one publicly reachable per-user) can opt back into the strict default
// either by toggling `Setting.blockPrivateInstanceHosts` in the admin UI or
// - for boot-time enforcement - by setting `UA_BLOCK_PRIVATE_INSTANCE_HOSTS=true`
// (or, for backwards compatibility with previous installs,
// `UA_ALLOW_PRIVATE_INSTANCE_HOSTS=false`). The env vars override the DB
// setting so an operator can lock strict-mode in regardless of UI state.
export function privateHostsAllowedForArrInstance(): boolean {
  const block =
    process.env.UA_BLOCK_PRIVATE_INSTANCE_HOSTS?.toLowerCase().trim();
  if (block === "1" || block === "true" || block === "yes") return false;
  const allow =
    process.env.UA_ALLOW_PRIVATE_INSTANCE_HOSTS?.toLowerCase().trim();
  if (allow === "0" || allow === "false" || allow === "no") return false;
  if (allow === "1" || allow === "true" || allow === "yes") return true;
  // No env override → fall back to the live DB snapshot. AppState defaults
  // to `blockPrivateInstanceHosts = false`, which keeps the permissive
  // default for self-hosted setups even before `reloadSettings()` has run.
  try {
    return !getAppState().settings.blockPrivateInstanceHosts;
  } catch {
    return true;
  }
}
