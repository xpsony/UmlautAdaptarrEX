import type { FastifyInstance } from "fastify";
import { prisma } from "@/lib/db";
import { dummyVerifyPassword, verifyPassword } from "@/lib/auth/password";
import {
  getSession,
  revokeSession,
  rotateSessionForUser,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/session";
import { CSRF_COOKIE } from "@/lib/auth/csrf";
import { requireAuth } from "@/server/auth/middleware";
import { latestChangelog } from "@/lib/changelog";
import { LoginSchema } from "@/schemas/auth";
import { parseOrReply } from "./_helpers";
import { csrfCookieOptions, sessionCookieOptions } from "./_auth-cookies";

export async function loginRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "5 minutes",
          keyGenerator: (req) => req.ip,
          // Surface bruteforce hits — without this the only signal is a 429
          // status the user never sees in the log stream.
          onExceeded: (req) => {
            req.log.warn(
              { ip: req.ip, ua: req.headers["user-agent"] ?? null },
              "login rate-limit exceeded",
            );
          },
        },
      },
    },
    async (req, reply) => {
      const data = parseOrReply(req.body, LoginSchema, reply);
      if (!data) {
        req.log.warn(
          { ip: req.ip, ua: req.headers["user-agent"] ?? null },
          "login rejected: validation",
        );
        return;
      }
      const user = await prisma.adminUser.findUnique({
        where: { username: data.username },
      });
      if (!user) {
        // Burn an argon2.verify against a fixed dummy hash so the wall-clock
        // matches the valid-user path. Without this an attacker can probe
        // for existing usernames by measuring response time (real verify
        // ~50 ms vs. instant 401).
        await dummyVerifyPassword(data.password);
        req.log.warn(
          {
            username: data.username,
            ip: req.ip,
            ua: req.headers["user-agent"] ?? null,
          },
          "login rejected: unknown username",
        );
        return reply.code(401).send({ error: "invalid-credentials" });
      }

      const ok = await verifyPassword(user.passwordHash, data.password);
      if (!ok) {
        req.log.warn({ username: user.username, ip: req.ip }, "login rejected: bad password");
        return reply.code(401).send({ error: "invalid-credentials" });
      }

      // Rotate the session ID: drop any prior sessions for this user and
      // mint a fresh ID. Defeats session-fixation attacks where a leaked
      // pre-auth cookie could otherwise stay valid for the full TTL.
      const session = await rotateSessionForUser(user.id);
      reply.setCookie(SESSION_COOKIE, session.id, sessionCookieOptions(req, SESSION_TTL_MS));
      const csrf = reply.generateCsrf();
      reply.setCookie(CSRF_COOKIE, csrf, csrfCookieOptions(req));

      req.log.info({ username: user.username, userId: user.id, ip: req.ip }, "login ok");
      return { ok: true, csrf };
    },
  );

  // Logout is a state-changing POST; require both a valid session and the
  // CSRF token (via `requireAuth`) so a malicious cross-site can't force a
  // logout. Stale-cookie clients hit 401, they are effectively "logged out"
  // already, so no UX regression.
  app.post("/api/auth/logout", { preHandler: requireAuth }, async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) await revokeSession(sid);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(CSRF_COOKIE, { path: "/" });
    // The plugin's secret cookie. Clearing it forces the next login to
    // start a fresh CSRF chain rather than reusing a stale secret.
    reply.clearCookie("_csrf", { path: "/" });
    req.log.info({ userId: req.session?.userId ?? null, ip: req.ip }, "logout");
    return { ok: true };
  });

  app.get(
    "/api/auth/me",
    {
      // Light per-IP cap. The UI polls this on every page load, so it must
      // stay generous, but an unauthenticated caller shouldn't be able to
      // hammer the session lookup / DB read unbounded.
      config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: (req) => req.ip } },
    },
    async (req, reply) => {
      const sid = req.cookies[SESSION_COOKIE];
      if (!sid) return reply.code(401).send({ error: "unauthorized" });
      const session = await getSession(sid);
      if (!session) return reply.code(401).send({ error: "unauthorized" });
      const user = await prisma.adminUser.findUnique({
        where: { id: session.userId },
      });
      if (!user) return reply.code(401).send({ error: "unauthorized" });
      return {
        id: user.id,
        username: user.username,
        lastSeenChangelog: user.lastSeenChangelog,
      };
    },
  );

  // Acknowledge the changelog: marks the current user as having seen up to the
  // newest entry, so the once-per-user popup never shows again until a newer
  // release ships. The version is server-determined (always the latest) so the
  // client cannot spoof a future version it hasn't actually been shown.
  app.post("/api/auth/changelog/seen", { preHandler: requireAuth }, async (req) => {
    const version = latestChangelog()?.version ?? null;
    await prisma.adminUser.update({
      where: { id: req.session!.userId },
      data: { lastSeenChangelog: version },
    });
    return { lastSeenChangelog: version };
  });
}
