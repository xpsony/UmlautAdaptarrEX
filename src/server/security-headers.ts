import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Minimal hand-rolled security headers - avoids the @fastify/helmet dep just
// to set a handful of static values.
//
//   - X-Frame-Options: DENY            - blocks click-jacking on the login form
//   - X-Content-Type-Options: nosniff  - prevents MIME-type sniffing
//   - Referrer-Policy: same-origin     - don't leak admin URLs to indexer hosts
//   - X-DNS-Prefetch-Control: off      - reduces DNS-leak surface
//   - Permissions-Policy               - disables sensors/camera/mic for the API
//
// HSTS is intentionally NOT set because self-hosted deployments often run on
// plain HTTP behind a home-LAN reverse proxy. Operators behind real TLS should
// set HSTS via their reverse proxy.
export function applySecurityHeaders(app: FastifyInstance): void {
  app.addHook(
    "onSend",
    async (_req: FastifyRequest, reply: FastifyReply, payload) => {
      reply.header("X-Frame-Options", "DENY");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "same-origin");
      reply.header("X-DNS-Prefetch-Control", "off");
      reply.header(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      );
      return payload;
    },
  );
}
