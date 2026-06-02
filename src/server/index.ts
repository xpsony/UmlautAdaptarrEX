import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import Fastify from "fastify";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/db";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import csrfProtection from "@fastify/csrf-protection";
import { LogBroadcaster } from "./logging/broadcast";
import type { AppLogger } from "./logging/logger";
import { createLogger } from "./logging/logger";
import { redactApiKey } from "@/lib/log-redact";
import { LogRetentionScheduler } from "./logging/retention";
import { getAppState } from "./state";
import { loginRoutes } from "./routes/admin/login";
import { setupRoutes } from "./routes/admin/setup";
import { instanceCrudRoutes } from "./routes/admin/instances-crud";
import { prowlarrAdminRoutes } from "./routes/admin/prowlarr-admin";
import { settingsRoutes } from "./routes/admin/settings";
import { pauseRoutes } from "./routes/admin/pause";
import { historyRoutes } from "./routes/admin/history";
import { pluginRoutes } from "./routes/admin/plugins";
import { syncRoutes } from "./routes/admin/sync";
import { systemRoutes } from "./routes/admin/system";
import { handleCaps } from "./routes/legacy/caps";
import { handleSearch } from "./routes/legacy/search";
import { isLoopbackRequest } from "./routes/legacy/util";
import { IndexerFetcher } from "./proxy/indexer-fetcher";
import { HttpProxyServer } from "./proxy/http-proxy";
import { DisabledProxyStubServer } from "./proxy/disabled-stub";
import { SyncScheduler } from "./sync/scheduler";
import { cancelStaleRuns } from "./sync/run";
import { SESSION_TTL_MS } from "@/lib/auth/session";
import { ensureCsrfSecret, getCsrfSecret } from "@/lib/auth/csrf";
import { SessionRetentionScheduler } from "./auth/session-retention";
import { parseTrustProxy } from "./trust-proxy";
import { applySecurityHeaders } from "./security-headers";
import { resolveLegacyApiPort } from "@/lib/ports";

export interface BootOptions {
  port: number;
  proxyPort?: number;
}

export async function bootServer(opts: BootOptions): Promise<{
  close: () => Promise<void>;
}> {
  const broadcaster = new LogBroadcaster();
  const logger = createLogger({ broadcaster });
  const state = getAppState();
  state.setLogger(logger);

  await state.reloadSettings();
  await ensureCsrfSecret();
  // One-shot backfill for existing installations: when setup is already
  // complete but proxy credentials are still empty (migration from the old
  // apiKey-based auth), generate a password once. The default username
  // "UmlautAdaptarr" comes from the schema default.
  if (state.settings.setupComplete && !state.settings.proxyPassword) {
    await prisma.setting.update({
      where: { id: 1 },
      data: { proxyPassword: nanoid(24) },
    });
    await state.reloadSettings();
    logger.info(
      "generated initial proxy password for existing installation — visit Settings → Advanced to view it",
    );
  }
  await state.loadSearchItemsFromDb();

  const fetcher = new IndexerFetcher(state, logger);

  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy,
    bodyLimit: 5 * 1024 * 1024,
    // Errors are logged centrally below; slow requests are logged via onResponse.
    disableRequestLogging: true,
  });

  installErrorHandlers(app, logger);
  installRequestTiming(app, logger);
  applySecurityHeaders(app);

  // Cookie-signing secret = the same per-install CSRF secret persisted in
  // the DB. Reusing it lets the CSRF plugin tamper-protect its `_csrf` cookie
  // without us having to manage a separate key.
  await app.register(cookie, { secret: getCsrfSecret().toString("base64") });
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: "1 minute",
  });
  // @fastify/csrf-protection. Defaults: secret cookie `_csrf` (httpOnly,
  // signed via the cookie secret above). The token comes in via
  // `x-csrf-token` to match the existing UI; cookieOpts mirror the session
  // cookie (sameSite=lax, path=/, secure derived from req.protocol via
  // trustProxy when the cookie is set). Without `userInfo: true` the token
  // is not session-bound — that's fine because the secret cookie is itself
  // tied to the session via httpOnly+sameSite, and stealing both halves
  // requires either XSS (game over anyway) or a cross-site bypass that
  // sameSite=lax already blocks.
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

  const legacyHandlers = {
    caps: (req: Parameters<typeof handleCaps>[0], reply: Parameters<typeof handleCaps>[1]) =>
      handleCaps(req, reply, { fetcher }),
    search: (req: Parameters<typeof handleSearch>[0], reply: Parameters<typeof handleSearch>[1]) =>
      handleSearch(req, reply, { type: "search" }, { fetcher }),
    tvsearch: (
      req: Parameters<typeof handleSearch>[0],
      reply: Parameters<typeof handleSearch>[1],
    ) => handleSearch(req, reply, { type: "tvsearch" }, { fetcher }),
    movie: (req: Parameters<typeof handleSearch>[0], reply: Parameters<typeof handleSearch>[1]) =>
      handleSearch(req, reply, { type: "movie" }, { fetcher }),
    music: (req: Parameters<typeof handleSearch>[0], reply: Parameters<typeof handleSearch>[1]) =>
      handleSearch(req, reply, { type: "music" }, { fetcher }),
    book: (req: Parameters<typeof handleSearch>[0], reply: Parameters<typeof handleSearch>[1]) =>
      handleSearch(req, reply, { type: "book" }, { fetcher }),
  };

  app.get("/api/health", async (_req, reply) => {
    // Public endpoint: keep the response opaque. Past versions exposed
    // `process.uptime()` here, which leaks restart times an external
    // probe could correlate with deploys for narrow timing attacks.
    await reply.send({ status: "ok" });
  });

  app.get("/:apiKey/*", async (req, reply) => {
    // Mode gate: in "proxy" mode the legacy indexer API responds externally
    // with a plain-text 503 so Prowlarr/Sonarr/etc. immediately see why the
    // request fails instead of getting a 404 or empty caps XML. Loopback
    // callers (the co-hosted HTTP proxy on :5006 calls 127.0.0.1:appPort to
    // reuse the shared caps/search handlers) must still pass through;
    // otherwise the proxy variant breaks. Live check: changing settings
    // takes effect immediately, no server restart required.
    if (state.settings.operationMode === "proxy" && !isLoopbackRequest(req)) {
      await reply
        .code(503)
        .header("content-type", "text/plain; charset=utf-8")
        .send("Index Legacy Api wurde deaktiviert, bitte Einstellungen anpassen");
      return;
    }
    const t = (req.query as { t?: string }).t;
    const handler = t ? legacyHandlers[t as keyof typeof legacyHandlers] : undefined;
    if (!handler) {
      await reply.code(404).send({ error: "Not found" });
      return;
    }
    await handler(req, reply);
  });

  const scheduler = new SyncScheduler({ logger });
  const logRetention = new LogRetentionScheduler({ logger });
  const sessionRetention = new SessionRetentionScheduler({ logger });

  await setupRoutes(app);
  await loginRoutes(app);
  await instanceCrudRoutes(app);
  await prowlarrAdminRoutes(app);
  await settingsRoutes(app);
  await pauseRoutes(app);
  await historyRoutes(app);
  await pluginRoutes(app);
  await syncRoutes(app, { scheduler });
  await systemRoutes(app);

  await app.ready();
  broadcaster.attachToHttp(app.server);

  const proxyPort = opts.proxyPort ?? state.settings.proxyPort ?? 5006;
  // operationMode is read once at boot — switching modes in Settings logs a
  // hint that a restart is required for port 5006. Live-switching would
  // require open() / close() of two competing servers on the same port and
  // isn't worth the complexity for what is a once-per-install decision.
  const proxyMode = state.settings.operationMode;
  const httpProxy =
    proxyMode === "legacy"
      ? new DisabledProxyStubServer({ port: proxyPort, logger })
      : new HttpProxyServer({
          port: proxyPort,
          appPort: opts.port,
          state,
          logger,
        });
  await httpProxy.start();

  await app.listen({ port: opts.port, host: "0.0.0.0" });
  logger.info(
    {
      port: opts.port,
      proxyPort,
      operationMode: proxyMode,
      nodeVersion: process.version,
      pid: process.pid,
      logLevel: logger.level,
      setupComplete: state.settings.setupComplete,
      cacheDurationMinutes: state.settings.cacheDurationMinutes,
      logRetentionDays: state.settings.logRetentionDays,
      providerConfigured: !!state.provider,
      trustProxy:
        typeof trustProxy === "boolean" || typeof trustProxy === "number"
          ? trustProxy
          : Array.isArray(trustProxy)
            ? trustProxy.join(",")
            : trustProxy,
    },
    "fastify gateway listening",
  );

  if (SESSION_TTL_MS > 60 * 24 * 60 * 60 * 1000) {
    logger.warn(
      { sessionTtlDays: Math.round(SESSION_TTL_MS / (24 * 60 * 60 * 1000)) },
      "long admin session TTL active (dev mode) — never run with this config in production",
    );
  }

  await cancelStaleRuns(logger);
  scheduler.start();
  logRetention.start();
  sessionRetention.start();

  return {
    async close() {
      scheduler.stop();
      logRetention.stop();
      sessionRetention.stop();
      broadcaster.stop();
      await httpProxy.stop();
      await app.close();
    },
  };
}

function installErrorHandlers(app: FastifyInstance, logger: AppLogger): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status =
      typeof err.statusCode === "number" && err.statusCode >= 400 ? err.statusCode : 500;
    const ctx = {
      reqId: req.id,
      method: req.method,
      // Legacy routes use `/<appApiKey>/<host>/api?…`. Strip the leading
      // key segment + any `apikey=` query value before the URL hits the
      // log so a malformed request can't leak the operator's appApiKey.
      url: redactApiKey(req.url),
      ip: req.ip,
      status,
      err,
    };
    if (status >= 500) {
      req.log.error(ctx, "request failed");
    } else {
      req.log.warn(ctx, "request rejected");
    }
    // Suppress duplicate logging from the onResponse hook.
    (req as FastifyRequest & { _loggedError?: boolean })._loggedError = true;
    if (reply.sent) return;
    if (err.validation) {
      void reply.code(400).send({
        error: "validation",
        issues: err.validation,
        message: err.message,
      });
      return;
    }
    // `@fastify/csrf-protection` raises FST_CSRF_MISSING_SECRET when the
    // signed `_csrf` cookie is gone or its signature no longer matches
    // (e.g. the server's csrfSecret rotated, browser dropped the cookie).
    // Translate both CSRF codes into the SPA-known `csrf-invalid` shape so
    // `isSessionLost` triggers a clean redirect to /login instead of
    // surfacing the raw "Missing csrf secret" string in a toast.
    if (err.code === "FST_CSRF_MISSING_SECRET" || err.code === "FST_CSRF_INVALID_TOKEN") {
      void reply.code(403).send({ error: "csrf-invalid" });
      return;
    }
    void reply.code(status).send({
      error: status >= 500 ? "internal" : "request_error",
      message: status >= 500 ? "Internal server error" : err.message,
    });
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    req.log.debug(
      { reqId: req.id, method: req.method, url: redactApiKey(req.url) },
      "route not found",
    );
    void reply.code(404).send({ error: "not_found" });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(
      { err: reason instanceof Error ? reason : new Error(String(reason)) },
      "unhandled promise rejection",
    );
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
  });
}

function installRequestTiming(app: FastifyInstance, _logger: AppLogger): void {
  const SLOW_REQUEST_MS = 5_000;
  app.addHook("onRequest", async (req: FastifyRequest) => {
    (req as FastifyRequest & { _startNs?: bigint })._startNs = process.hrtime.bigint();
  });
  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const startNs = (req as FastifyRequest & { _startNs?: bigint })._startNs;
    if (startNs === undefined) return;
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const status = reply.statusCode;
    const slow = durationMs >= SLOW_REQUEST_MS;
    const errored = status >= 400;
    // Skip fast successes — admin UI polls every 5s and would flood the log.
    if (!slow && !errored) return;
    const alreadyLogged = (req as FastifyRequest & { _loggedError?: boolean })._loggedError;
    if (errored && alreadyLogged) return;
    const ctx = {
      reqId: req.id,
      method: req.method,
      url: redactApiKey(req.url),
      status,
      durationMs,
    };
    if (status >= 500) {
      req.log.error(ctx, "request errored");
    } else if (status >= 400) {
      req.log.warn(ctx, "request rejected");
    } else {
      req.log.warn(ctx, "slow request");
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = resolveLegacyApiPort();
  bootServer({ port }).catch((err) => {
    console.error("[boot] fatal error:", err);
    process.exit(1);
  });
}
