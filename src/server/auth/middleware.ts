import type { FastifyReply, FastifyRequest } from "fastify";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";

declare module "fastify" {
  interface FastifyRequest {
    session?: { id: string; userId: string };
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Two-stage preHandler:
//   1. Session-cookie check → reject 401 if missing/expired.
//   2. CSRF check via @fastify/csrf-protection plugin (only on unsafe
//      methods). The plugin verifies the `x-csrf-token` header against the
//      signed `_csrf` cookie's secret.
//
// The plugin is fully synchronous: on success it invokes the `next`
// callback, on failure it calls `reply.send(err)` directly without ever
// touching the callback. The global error handler in `src/server/index.ts`
// translates the resulting FST_CSRF_* error codes into the SPA-known
// `{error: "csrf-invalid"}` shape.
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) {
    req.log.debug(
      { url: req.url, method: req.method, ip: req.ip },
      "auth rejected: no session cookie",
    );
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  const session = await getSession(sid);
  if (!session) {
    req.log.debug(
      { url: req.url, method: req.method, ip: req.ip },
      "auth rejected: session expired or unknown",
    );
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  req.session = session;

  if (!SAFE_METHODS.has(req.method)) {
    // `@fastify/csrf-protection` invokes its hook with the standard
    // (err, _req, _reply, next) signature. Wrap it in a promise so we
    // observe the actual outcome instead of inspecting a sync flag - the
    // plugin can resolve asynchronously (and a future upgrade might also
    // make the validate path async). The global error handler turns the
    // FST_CSRF_* codes into `{error: "csrf-invalid"}`.
    try {
      await new Promise<void>((resolve, reject) => {
        req.server.csrfProtection(req, reply, (err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      req.log.warn(
        { url: req.url, method: req.method, ip: req.ip, err },
        "auth rejected: invalid CSRF token",
      );
      if (!reply.sent) {
        reply.code(403).send({ error: "csrf-invalid" });
      }
      return;
    }
  }
}
