import { type WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

interface LogPayload {
  level: string;
  message: string;
  context: string | null;
  createdAt: Date;
}

function parseSessionCookie(req: IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

// Validate that the WS upgrade originates from a trusted UI origin. Browsers
// send `Origin` for WebSocket handshakes; non-browser clients (curl, scripts)
// typically don't and are accepted as long as they have a valid session
// cookie. This blocks cross-site WebSocket hijacking (CSWSH) where a
// malicious page tries to open a WS to /ws/logs while the user's session
// cookie is implicitly sent. (Same-site cookies already make this hard, but
// defense-in-depth.)
//
// Two valid topologies:
//  1. Single-origin (reverse proxy folds UI + API onto one host:port) —
//     origin.host === request.host.
//  2. Dual-port (default architecture, UI on WEB_PORT, Fastify on this port) —
//     same hostname, origin.port === WEB_PORT (default 5007).
function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === host) return true;
    const requestUrl = new URL(`http://${host}`);
    if (originUrl.hostname !== requestUrl.hostname) return false;
    const webPort = process.env.WEB_PORT ?? "5007";
    return originUrl.port === webPort;
  } catch {
    return false;
  }
}

// Lightweight in-memory sliding-window rate limiter for the upgrade path.
// Keyed by remote address. Any attempt — successful or not — counts against
// the limit, so an attacker can't overwhelm the DB with `getSession` calls
// on a stolen-but-revoked cookie. The bucket is small to avoid drift across
// long-lived clients; legitimate users open at most one WS at a time.
const UPGRADE_LIMIT_WINDOW_MS = 60_000;
const UPGRADE_LIMIT_MAX = 30;

class UpgradeRateLimiter {
  private hits = new Map<string, number[]>();

  check(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - UPGRADE_LIMIT_WINDOW_MS;
    const arr = this.hits.get(ip) ?? [];
    const trimmed = arr.filter((t) => t > cutoff);
    if (trimmed.length >= UPGRADE_LIMIT_MAX) {
      this.hits.set(ip, trimmed);
      return false;
    }
    trimmed.push(now);
    this.hits.set(ip, trimmed);
    return true;
  }

  // Periodic cleanup so old entries don't linger forever.
  sweep(): void {
    const cutoff = Date.now() - UPGRADE_LIMIT_WINDOW_MS;
    for (const [ip, arr] of this.hits) {
      const trimmed = arr.filter((t) => t > cutoff);
      if (trimmed.length === 0) this.hits.delete(ip);
      else this.hits.set(ip, trimmed);
    }
  }
}

export class LogBroadcaster {
  private clients = new Set<WebSocket>();
  private throttleQueue: LogPayload[] = [];
  private throttleTimer: NodeJS.Timeout | null = null;
  private droppedSinceLastFlush = 0;
  private readonly maxPerSecond = 50;
  private readonly upgradeLimiter = new UpgradeRateLimiter();
  private upgradeSweepTimer: NodeJS.Timeout | null = null;

  attachToHttp(server: HttpServer, path = "/ws/logs"): void {
    const wss = new WebSocketServer({ noServer: true });
    const limiter = this.upgradeLimiter;
    // Periodic sweep so the IP-map doesn't accumulate forever.
    this.upgradeSweepTimer = setInterval(() => limiter.sweep(), 60_000);
    this.upgradeSweepTimer.unref?.();

    server.on("upgrade", (req, socket, head) => {
      if (req.url !== path) return;

      // 1. Origin-Check (CSWSH guard) — synchronous, free.
      if (!isOriginAllowed(req)) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        socket.destroy();
        return;
      }

      // 2. Per-IP rate limit, also synchronous, before any DB work.
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!limiter.check(ip)) {
        socket.write(
          "HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        socket.destroy();
        return;
      }

      // 3. Cookie-based session check. Use a read-only `findUnique` so
      //    a stolen-but-valid session cookie can't be used to flood the
      //    DB with `lastUsed`-update writes (`getSession` would do
      //    that on every read).
      void (async () => {
        const sid = parseSessionCookie(req);
        if (!sid) {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
          );
          socket.destroy();
          return;
        }
        const session = await prisma.session.findUnique({
          where: { id: sid },
          select: { expiresAt: true },
        });
        if (!session || session.expiresAt < new Date()) {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
          );
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          this.clients.add(ws);
          ws.on("close", () => this.clients.delete(ws));
          ws.on("error", () => this.clients.delete(ws));
        });
      })().catch((err) => {
        // We're inside the logging subsystem, so we can't safely use the
        // app logger (it could be the very thing that just threw). Fall
        // back to console.warn so the failure isn't silently swallowed.
        console.warn("[ws/logs] upgrade handler failed:", err);
        try {
          socket.destroy();
        } catch {
          /* socket may already be closed */
        }
      });
    });
  }

  broadcast(entry: LogPayload): void {
    if (this.clients.size === 0) return;
    if (this.throttleQueue.length >= this.maxPerSecond) {
      this.droppedSinceLastFlush++;
      return;
    }
    this.throttleQueue.push(entry);
    this.scheduleFlush();
  }

  stop(): void {
    if (this.upgradeSweepTimer) {
      clearInterval(this.upgradeSweepTimer);
      this.upgradeSweepTimer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  private scheduleFlush(): void {
    if (this.throttleTimer) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      const batch = this.throttleQueue.splice(0, this.throttleQueue.length);
      const dropped = this.droppedSinceLastFlush;
      this.droppedSinceLastFlush = 0;
      const payload = JSON.stringify({
        type: "logs",
        items: batch.map((b) => ({
          level: b.level,
          message: b.message,
          context: b.context,
          createdAt: b.createdAt.toISOString(),
        })),
        dropped,
      });
      for (const client of this.clients) {
        if (client.readyState === client.OPEN) {
          try {
            client.send(payload);
          } catch {
            this.clients.delete(client);
          }
        }
      }
    }, 100);
  }
}
