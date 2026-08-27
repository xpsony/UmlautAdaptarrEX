// IMPORTANT: import the db helper FIRST so DATABASE_URL is set before any
// transitive `@/lib/db` import constructs the prisma client.
import "./db";

import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";

import { ensureCsrfSecret, getCsrfSecret } from "@/lib/auth/csrf";
import { loginRoutes } from "@/server/routes/admin/login";
import { setupRoutes } from "@/server/routes/admin/setup";
import { instanceCrudRoutes } from "@/server/routes/admin/instances-crud";
import { prowlarrAdminRoutes } from "@/server/routes/admin/prowlarr-admin";
import { settingsRoutes } from "@/server/routes/admin/settings";
import { historyRoutes } from "@/server/routes/admin/history";
import { pluginRoutes } from "@/server/routes/admin/plugins";
import { systemRoutes } from "@/server/routes/admin/system";
import { titleOverrideRoutes } from "@/server/routes/admin/title-overrides";
import { syncRoutes } from "@/server/routes/admin/sync";
import { handleCaps } from "@/server/routes/legacy/caps";
import { handleSearch } from "@/server/routes/legacy/search";
import { isLoopbackRequest } from "@/server/routes/legacy/util";
import type { IndexerFetcher } from "@/server/proxy/indexer-fetcher";
import { SyncScheduler } from "@/server/sync/scheduler";
import type { AppLogger } from "@/server/logging/logger";
import { getAppState } from "@/server/state";

interface BuildOptions {
  /** When set, registers the legacy /:apiKey/* dispatcher with this fetcher. */
  legacyFetcher?: IndexerFetcher;
  /** Skip auth-related admin routes; leave only legacy + open setup. */
  adminOnly?: boolean;
}

// Mirrors the HTTP-gateway portion of `src/server/index.ts` without the TCP
// proxy, sync scheduler, log retention, or session cleanup. Sufficient for
// API tests that exercise routing, auth, CSRF, and the legacy dispatcher.
export async function buildTestApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  await ensureCsrfSecret();

  const app = Fastify({
    logger: process.env.UA_TEST_LOG === "1" ? { level: "debug" } : false,
  });

  // Same plugin order as production: cookie before csrf-protection, both
  // before any route that calls `reply.setCookie` or `reply.generateCsrf`.
  // We deliberately skip `@fastify/rate-limit` here. Several routes ship a
  // tight per-route config (e.g. login: 5/5min) that would interfere across
  // tests; rate-limit logic itself is exercised in production-style E2E.
  await app.register(cookie, { secret: getCsrfSecret().toString("base64") });
  await app.register(csrfProtection, {
    sessionPlugin: "@fastify/cookie",
    getToken: (req) => {
      const h = req.headers["x-csrf-token"];
      return Array.isArray(h) ? h[0] : h;
    },
    cookieOpts: {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      signed: true,
    },
  });

  // Match production error handler so CSRF/validation errors reach the SPA in
  // their expected shape.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) {
      void reply.code(400).send({
        error: "validation",
        issues: err.validation,
        message: err.message,
      });
      return;
    }
    if (err.code === "FST_CSRF_MISSING_SECRET" || err.code === "FST_CSRF_INVALID_TOKEN") {
      void reply.code(403).send({ error: "csrf-invalid" });
      return;
    }
    const status =
      typeof err.statusCode === "number" && err.statusCode >= 400 ? err.statusCode : 500;
    void reply.code(status).send({
      error: status >= 500 ? "internal" : "request_error",
      message: err.message,
    });
  });

  if (!opts.adminOnly) {
    await loginRoutes(app);
    await setupRoutes(app);
  }
  await instanceCrudRoutes(app);
  await prowlarrAdminRoutes(app);
  await settingsRoutes(app);
  await historyRoutes(app);
  await pluginRoutes(app);
  await systemRoutes(app);
  await titleOverrideRoutes(app);

  // Real SyncScheduler so the /sync route exercises the same orchestration
  // path as production. We never call .start() here; tests that need to run
  // sync work invoke runNow directly via the route.
  const noopLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => noopLogger,
    level: "info",
  } as unknown as AppLogger;
  const scheduler = new SyncScheduler({ logger: noopLogger });
  await syncRoutes(app, { scheduler });

  if (opts.legacyFetcher) {
    const fetcher = opts.legacyFetcher;
    app.get("/:apiKey/*", async (req, reply) => {
      // Mirror the production gate from src/server/index.ts: in "proxy" mode
      // the legacy indexer API responds 503 for non-loopback callers so
      // Sonarr/Radarr/etc. see why the request fails. Loopback callers (the
      // co-hosted HTTP-proxy on :5006) bypass to reuse the shared handlers.
      if (getAppState().settings.operationMode === "proxy" && !isLoopbackRequest(req)) {
        await reply
          .code(503)
          .header("content-type", "text/plain; charset=utf-8")
          .send("Index Legacy Api wurde deaktiviert, bitte Einstellungen anpassen");
        return;
      }
      const t = (req.query as { t?: string }).t;
      switch (t) {
        case "caps":
          await handleCaps(req, reply, { fetcher });
          return;
        case "search":
        case "tvsearch":
        case "movie":
        case "music":
        case "book":
          await handleSearch(req, reply, { type: t }, { fetcher });
          return;
        default:
          await reply.code(404).send({ error: "Not found" });
      }
    });
  }

  await app.ready();
  return app;
}

/**
 * Reads the value of a Set-Cookie pair by name from a Fastify inject response.
 * Tolerates both the array shape (multiple cookies) and the single-string form.
 */
export function readSetCookie(
  setCookie: string | string[] | undefined,
  name: string,
): string | null {
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const prefix = `${name}=`;
  for (const c of cookies) {
    const seg = c.split(";")[0];
    if (seg && seg.startsWith(prefix)) {
      // Set-Cookie values are URL-encoded for chars like `+` (`%2B`) and
      // `/` (`%2F`); light-my-request re-encodes them when we forward the
      // value via `cookies:`, which double-encodes and breaks signature
      // verification on signed cookies. Decode once here so the round-trip
      // matches what the original signer produced.
      return decodeURIComponent(seg.slice(prefix.length));
    }
  }
  return null;
}
