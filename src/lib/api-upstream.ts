import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { CSRF_COOKIE } from "@/lib/auth/csrf";
import { LOCALE_COOKIE } from "@/lib/i18n-config";

/**
 * Trusted Fastify base URL for server-side fetches from RSCs / Route Handlers.
 *
 * Why not derive from the request `host` header? In production behind a
 * reverse proxy that header is attacker-controlled — using it for an outgoing
 * fetch is a host-header SSRF foothold. Resolve from `API_UPSTREAM` instead,
 * with the in-process Fastify default; this matches what `src/proxy.ts`
 * uses to reverse-proxy the `/api/admin`, `/api/auth`, `/api/health` paths.
 */
export function getApiUpstream(): string {
  return process.env.API_UPSTREAM ?? "http://127.0.0.1:5005";
}

/** Build an absolute URL on the Fastify upstream for a given path. */
export function apiUrl(path: string): string {
  const base = getApiUpstream().replace(/\/+$/, "");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

/**
 * Forward the incoming admin session/CSRF cookies (only those — never the
 * full cookie jar) to a server-side fetch. Returned as a single header
 * string suitable for `fetch(... { headers: { cookie } })`.
 */
export async function forwardAuthCookies(): Promise<string> {
  const store = await cookies();
  const allowed = new Set<string>([SESSION_COOKIE, CSRF_COOKIE, LOCALE_COOKIE]);
  return store
    .getAll()
    .filter((c) => allowed.has(c.name))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
