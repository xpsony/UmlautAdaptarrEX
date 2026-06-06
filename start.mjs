#!/usr/bin/env node
// Process supervisor: spawn Next.js Standalone (UI) + boot Fastify Gateway in-process.
// Runs prisma migrate deploy first.
//
// Architecture:
//   - Web UI:    Next.js Standalone, public on WEB_PORT (default 5007).
//                Forwards `/api/admin/*`, `/api/auth/*`, `/titlelookup` to the
//                Fastify API via next.config.ts rewrites.
//   - API:       Fastify on PORT (default 5005), public. Serves *Arrs/Prowlarr
//                directly, plus Admin API and WS /ws/logs.
//   - HTTP proxy: On settings.proxyPort (default 5006).
//
// Self-supervising: this file runs in two modes. When invoked via
// `node start.mjs` it forks itself as a child with `UMLAUTADAPTARREX_SUPERVISED=1`,
// monitors the child, and re-spawns it on graceful-restart sentinel exit
// code 75. Any other exit propagates upward. The child does the actual app
// work. The signal `UMLAUTADAPTARREX_SUPERVISED=1` also flips the
// `/api/admin/system/capabilities` response so the UI knows whether the
// restart button can succeed.

import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Port resolution mirrors src/lib/ports.ts (single source of truth). This
// supervisor is plain .mjs and runs before the TS build is importable, so the
// logic is duplicated here. Only the branded UMLAUTADAPTARREX_* names are read;
// an empty value is treated as unset and falls back to the default. A
// present-but-invalid value throws so a misconfiguration fails fast. Only plain
// decimal-digit strings are accepted (rejects hex like "0x1F90" and float
// literals like "5005.0").
const resolvePort = (candidates, fallback) => {
  for (const value of candidates) {
    if (value === undefined || value.trim() === "") continue;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`invalid port "${value}" (expected integer 1-65535)`);
    }
    const n = Number(trimmed);
    if (n < 1 || n > 65535) {
      throw new Error(`invalid port "${value}" (expected integer 1-65535)`);
    }
    return n;
  }
  return fallback;
};

const PORT = resolvePort([process.env.UMLAUTADAPTARREX_LEGACYAPI_PORT], 5005);
const WEB_PORT = resolvePort([process.env.UMLAUTADAPTARREX_WEBUI_PORT], 5007);

const RESTART_EXIT_CODE = 75;
const SUPERVISOR_ENV = "UMLAUTADAPTARREX_SUPERVISED";

// ── Parent (self-supervising loop) ───────────────────────────────────────────
if (process.env[SUPERVISOR_ENV] !== "1") {
  // Forward SIGTERM/SIGINT to the active child so it can shut down cleanly.
  let activeChild = null;
  let parentShuttingDown = false;

  const forwardSignal = (sig) => {
    if (activeChild && !activeChild.killed) {
      activeChild.kill(sig);
    } else {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => {
    parentShuttingDown = true;
    forwardSignal("SIGTERM");
  });
  process.on("SIGINT", () => {
    parentShuttingDown = true;
    forwardSignal("SIGINT");
  });

  const spawnChild = () => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: __dirname,
      env: { ...process.env, [SUPERVISOR_ENV]: "1" },
      stdio: "inherit",
    });
    activeChild = child;
    child.on("exit", (code, signal) => {
      activeChild = null;
      if (parentShuttingDown) {
        process.exit(typeof code === "number" ? code : 0);
        return;
      }
      if (code === RESTART_EXIT_CODE) {
        console.log("[supervisor] child requested restart — respawning…");
        setTimeout(spawnChild, 250);
        return;
      }
      const exitCode = typeof code === "number" ? code : signal ? 128 : 1;
      process.exit(exitCode);
    });
  };

  spawnChild();
} else {
  // ── Child (the actual app) ────────────────────────────────────────────────
  let nextProc = null;
  let serverInstance = null;
  let shuttingDown = false;

  const runPrismaMigrate = () =>
    new Promise((resolve, reject) => {
      const proc = spawn("node", ["./node_modules/prisma/build/index.js", "migrate", "deploy"], {
        cwd: __dirname,
        stdio: "inherit",
      });
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`prisma migrate deploy exited with code ${code}`));
      });
    });

  const resolveNextStandalone = () => {
    const rootServer = path.join(__dirname, "server.js");
    if (existsSync(rootServer)) return { server: rootServer, dir: __dirname };

    const standaloneDir = path.join(__dirname, ".next", "standalone");
    const standaloneServer = path.join(standaloneDir, "server.js");
    if (!existsSync(standaloneServer)) {
      throw new Error(
        `Next.js standalone server not found. Looked for ${rootServer} (Docker ` +
          `layout) and ${standaloneServer} (bare-metal layout). ` +
          `Run \`pnpm build:prod\` first.`,
      );
    }

    for (const [src, dest] of [
      [path.join(__dirname, ".next", "static"), path.join(standaloneDir, ".next", "static")],
      [path.join(__dirname, "public"), path.join(standaloneDir, "public")],
    ]) {
      if (existsSync(src)) cpSync(src, dest, { recursive: true });
    }
    return { server: standaloneServer, dir: standaloneDir };
  };

  const startNext = () => {
    const { server: candidate, dir: nextCwd } = resolveNextStandalone();
    nextProc = spawn(process.execPath, [candidate], {
      cwd: nextCwd,
      env: {
        ...process.env,
        PORT: String(WEB_PORT),
        HOSTNAME: "0.0.0.0",
        API_UPSTREAM: `http://127.0.0.1:${PORT}`,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    nextProc.on("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(`[supervisor] Next.js exited unexpectedly: code=${code} signal=${signal}`);
      void shutdown(1);
    });
  };

  const startFastify = async () => {
    const mod = await import("./dist/server/index.js");
    serverInstance = await mod.bootServer({ port: PORT });
  };

  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(
      code === RESTART_EXIT_CODE
        ? "[supervisor] graceful restart requested — shutting down child…"
        : "[supervisor] shutting down…",
    );
    try {
      if (serverInstance) await serverInstance.close();
    } catch (err) {
      console.error("[supervisor] error stopping fastify:", err);
    }
    if (nextProc && !nextProc.killed) {
      nextProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 2000));
      if (!nextProc.killed) nextProc.kill("SIGKILL");
    }
    process.exit(code);
  };

  // Restart trigger from the admin API. Fastify runs in-process, so the
  // endpoint just emits this event on the shared `process` EventEmitter and
  // we run the full shutdown() — SIGTERM the Next.js child, close Fastify,
  // then exit 75 so the parent supervisor respawns. Without this hook a
  // direct `process.exit(75)` would leave the Next.js subprocess orphaned
  // and holding port 5007, so the respawn would fail with EADDRINUSE and
  // the supervisor would propagate the failure as exit 1 (= container dies).
  process.on("umlautadaptarrex:restart", () => void shutdown(RESTART_EXIT_CODE));

  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
  process.on("uncaughtException", (err) => {
    console.error("[supervisor] uncaught exception:", err);
    void shutdown(1);
  });

  (async () => {
    try {
      console.log("[supervisor] running prisma migrate deploy…");
      await runPrismaMigrate();
      console.log(`[supervisor] starting Fastify gateway on :${PORT}…`);
      await startFastify();
      console.log(`[supervisor] starting Next.js standalone on :${WEB_PORT}…`);
      startNext();
      console.log("[supervisor] ready");
    } catch (err) {
      console.error("[supervisor] fatal startup error:", err);
      void shutdown(1);
    }
  })();
}
