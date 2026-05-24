import type { FastifyRequest } from "fastify";

// We mark cookies `Secure` exactly when the request itself arrived over
// HTTPS. Self-hosted deployments routinely run plaintext on a LAN
// (see the no-`__Host-`-prefix note in `src/lib/auth/session.ts`), and
// a hard `Secure` flag there would make the browser silently drop the
// cookie on the next request, surfacing as an instant "Session expired"
// directly after login. Operators terminating TLS upstream should set
// TRUST_PROXY so Fastify reads `X-Forwarded-Proto` and `req.protocol`
// reflects the original scheme.
function deriveSecure(req: FastifyRequest): boolean {
  return req.protocol === "https";
}

export const sessionCookieOptions = (
  req: FastifyRequest,
  maxAgeMs: number,
) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: deriveSecure(req),
  path: "/",
  maxAge: Math.floor(maxAgeMs / 1000),
});

export const csrfCookieOptions = (req: FastifyRequest) => ({
  httpOnly: false,
  sameSite: "lax" as const,
  secure: deriveSecure(req),
  path: "/",
});
