import net from "node:net";
import { timingSafeEqual } from "node:crypto";
import { request as undiciRequest } from "undici";
import type { AppLogger } from "@/server/logging/logger";
import type { AppState } from "@/server/state";
import { isPrivateHost } from "@/server/security/ssrf";
import { redactApiKey } from "@/lib/log-redact";

const KNOWN_HTTPS_HOSTS = new Set(["prowlarr.servarr.com"]);

// Backoff schedule for the watchdog. Each unexpected listener death advances
// one step; a successful re-listen that holds for BACKOFF_RESET_MS resets to
// the first step. Capped at the last entry, so a permanently broken bind
// (e.g. port collision) won't spin.
const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 60_000] as const;
const BACKOFF_RESET_MS = 60_000;

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Burn constant time even on length mismatch so the comparison cost
    // doesn't reveal the expected length.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

interface HttpProxyOptions {
  port: number;
  appPort: number;
  state: AppState;
  logger: AppLogger;
}

// TCP HTTP-proxy used by Prowlarr indexers.
//   - HTTP requests are rewritten to http://localhost:{appPort}/{apiKey}/{host}{path}
//   - HTTPS CONNECT tunnels are passed through only for known hosts
//   - Proxy-Authorization: Basic checked against the per-install proxy
//     credentials (Setting.proxyUsername / proxyPassword). Auth is only
//     enforced when both fields are populated — empty values disable it.
export class HttpProxyServer {
  private server: net.Server | null = null;
  private readonly knownHosts = new Set(KNOWN_HTTPS_HOSTS);
  private stopping = false;
  private restartAttempt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthyTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: HttpProxyOptions) {}

  async start(): Promise<void> {
    this.stopping = false;
    await this.bind();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private bind(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleSocket(socket).catch((err) => {
          this.opts.logger.error(
            { err, remoteAddress: socket.remoteAddress },
            "http-proxy socket error",
          );
          socket.destroy();
        });
      });

      // Initial bind: surface the error to the caller via reject; the watchdog
      // listeners are wired only after the first successful listen, so a bad
      // initial bind fails loudly instead of silently retrying forever.
      const onInitialError = (err: Error): void => {
        server.removeListener("error", onInitialError);
        reject(err);
      };
      server.once("error", onInitialError);

      server.listen(this.opts.port, () => {
        server.removeListener("error", onInitialError);
        this.server = server;
        this.opts.logger.info(
          { port: this.opts.port, attempt: this.restartAttempt },
          this.restartAttempt > 0
            ? "http-proxy listening (recovered after watchdog restart)"
            : "http-proxy listening",
        );
        this.attachWatchdog(server);
        // If the new listener holds for BACKOFF_RESET_MS without dying, treat
        // it as healthy and reset the backoff. Without this, a chain of
        // flaky restarts would creep toward the 60s cap and stay there.
        this.healthyTimer = setTimeout(() => {
          if (this.restartAttempt > 0) {
            this.opts.logger.info(
              { port: this.opts.port },
              "http-proxy watchdog: listener stable, backoff reset",
            );
          }
          this.restartAttempt = 0;
          this.healthyTimer = null;
        }, BACKOFF_RESET_MS);
        resolve();
      });
    });
  }

  private attachWatchdog(server: net.Server): void {
    const onUnexpectedDeath = (reason: string, err?: Error): void => {
      if (this.stopping) return;
      if (this.server !== server) return; // stale event from a prior listener
      this.opts.logger.error(
        { port: this.opts.port, reason, err },
        "http-proxy watchdog: listener died unexpectedly",
      );
      this.server = null;
      if (this.healthyTimer) {
        clearTimeout(this.healthyTimer);
        this.healthyTimer = null;
      }
      this.scheduleRestart();
    };

    server.on("error", (err) => onUnexpectedDeath("error", err));
    server.on("close", () => onUnexpectedDeath("close"));
  }

  private scheduleRestart(): void {
    if (this.stopping) return;
    if (this.restartTimer) return;
    const idx = Math.min(this.restartAttempt, RESTART_BACKOFF_MS.length - 1);
    const delay = RESTART_BACKOFF_MS[idx];
    this.restartAttempt += 1;
    this.opts.logger.warn(
      { port: this.opts.port, delayMs: delay, attempt: this.restartAttempt },
      "http-proxy watchdog: scheduling restart",
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping) return;
      this.bind().catch((err) => {
        this.opts.logger.error(
          { port: this.opts.port, err, attempt: this.restartAttempt },
          "http-proxy watchdog: rebind failed, scheduling another retry",
        );
        this.scheduleRestart();
      });
    }, delay);
    // Don't keep the process alive solely for the retry timer; if everything
    // else has shut down, the proxy shouldn't be the reason Node lingers.
    this.restartTimer.unref?.();
  }

  private async handleSocket(socket: net.Socket): Promise<void> {
    socket.setKeepAlive(true);
    const initial = await readUntilHeaders(socket);
    if (!initial) {
      this.opts.logger.debug(
        { remoteAddress: socket.remoteAddress },
        "http-proxy: client closed/timed out before sending full headers",
      );
      socket.destroy();
      return;
    }

    const expectedUser = this.opts.state.settings.proxyUsername;
    const expectedPass = this.opts.state.settings.proxyPassword;
    if (expectedUser && expectedPass) {
      const auth = matchHeader(initial.headerStr, "Proxy-Authorization");
      if (!auth || !this.validateAuth(auth, expectedUser, expectedPass)) {
        // Missing header is normal RFC 7235 negotiation (client sends without
        // creds, gets 407 + Proxy-Authenticate, retries with creds). Only
        // present-but-invalid headers warrant WARN.
        const ctx = {
          remoteAddress: socket.remoteAddress,
          hasAuthHeader: Boolean(auth),
          authPrefix: auth ? auth.slice(0, 6) : null,
          expectedUser,
        };
        if (auth) {
          this.opts.logger.warn(ctx, "http-proxy 407: Proxy-Authorization invalid");
        } else {
          this.opts.logger.debug(ctx, "http-proxy 407: Proxy-Authorization missing");
        }
        socket.write(
          "HTTP/1.1 407 Proxy Authentication Required\r\n" +
            'Proxy-Authenticate: Basic realm="Proxy"\r\n' +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n\r\n",
        );
        socket.end();
        return;
      }
    }

    const firstLine = initial.headerStr.split("\r\n", 1)[0] ?? "";
    if (firstLine.startsWith("CONNECT ")) {
      await this.handleConnect(socket, firstLine);
    } else {
      await this.handleHttp(socket, firstLine, initial.headerStr);
    }
  }

  private validateAuth(headerValue: string, expectedUser: string, expectedPass: string): boolean {
    if (!/^Basic\s+/i.test(headerValue)) return false;
    const encoded = headerValue.replace(/^Basic\s+/i, "").trim();
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return false;
    }
    // Username may not contain ':'; the password may. Split at the first ':'.
    const sep = decoded.indexOf(":");
    if (sep < 0) return false;
    const user = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);
    // Constant-time compare both fields. Always evaluate the password check
    // even when the username mismatches so timing doesn't leak which half
    // failed.
    const userOk = constantTimeEquals(user, expectedUser);
    const passOk = constantTimeEquals(password, expectedPass);
    return userOk && passOk;
  }

  private async handleConnect(socket: net.Socket, firstLine: string): Promise<void> {
    const target = firstLine.split(" ")[1] ?? "";
    const [host, portStr] = target.split(":");
    const port = parseInt(portStr ?? "443", 10);

    if (!host) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    // Reject CONNECTs to private/loopback ranges to prevent internal-network
    // pivots through the proxy. The known-hosts allow-list is built from a
    // static seed (KNOWN_HTTPS_HOSTS); host-add at runtime no longer happens
    // for HTTP requests (see handleHttp).
    if (isPrivateHost(host)) {
      this.opts.logger.warn(
        { host, port, remoteAddress: socket.remoteAddress },
        "http-proxy CONNECT rejected: private/loopback target",
      );
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    // Hard-enforce the static CONNECT allow-list. Without this the proxy is
    // an open TCP relay for any public host on any port — auth is optional
    // (empty Setting.proxyPassword disables it) and isPrivateHost() only
    // blocks internal targets, so the only thing standing between an
    // attacker on the LAN and arbitrary outbound TCP is this list.
    // Indexers normally use http:// (which goes through handleHttp); the
    // only legitimate HTTPS CONNECT target today is prowlarr.servarr.com.
    if (!this.knownHosts.has(host)) {
      this.opts.logger.warn(
        { host, port, remoteAddress: socket.remoteAddress },
        "http-proxy CONNECT rejected: host not in static allow-list (indexer should use http:// not https://)",
      );
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    // Pin to 443 — the allow-list entries are public HTTPS endpoints, so
    // any other port (25, 465, 6667, 22, …) would be the relay-abuse case
    // we just ruled out by host.
    if (port !== 443) {
      this.opts.logger.warn(
        { host, port, remoteAddress: socket.remoteAddress },
        "http-proxy CONNECT rejected: non-443 port on allow-listed host",
      );
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    // Idle timeout for the tunnel: if neither end sends data for this long,
    // tear both sockets down so a half-open/abandoned CONNECT can't pin the
    // upstream socket open indefinitely. 120s is comfortably above normal
    // request/response latency while still reclaiming dead tunnels promptly.
    const CONNECT_IDLE_TIMEOUT_MS = 120_000;

    const upstream = net.connect({ host, port }, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.setTimeout(CONNECT_IDLE_TIMEOUT_MS);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", (err) => {
      this.opts.logger.error({ host, port, err }, "http-proxy CONNECT upstream error");
      // Destroy upstream too; .end()-ing only the client left the upstream
      // socket leaked on error.
      upstream.destroy();
      try {
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      } catch {
        /* socket may already be closed */
      }
    });
    // Tear the client side down if upstream closes cleanly mid-stream.
    upstream.on("close", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    socket.on("timeout", () => {
      socket.destroy();
      upstream.destroy();
    });
  }

  private async handleHttp(
    socket: net.Socket,
    firstLine: string,
    headerStr: string,
  ): Promise<void> {
    const started = process.hrtime.bigint();
    let url: URL | null = null;
    try {
      const [method, urlStr] = firstLine.split(" ");
      if (!urlStr) {
        this.opts.logger.warn(
          {
            firstLine: redactApiKey(firstLine),
            remoteAddress: socket.remoteAddress,
          },
          "http-proxy 400: missing URL in request line",
        );
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      url = new URL(urlStr);
      // Legacy wire behavior: every proxied request is forced to GET — the
      // .NET predecessor did the same (HttpProxyService.cs, HttpMethod.Get)
      // and the legacy API only registers GET routes. Say so out loud
      // instead of silently degrading; a POST body, if any, is dropped.
      if (method !== "GET") {
        this.opts.logger.warn(
          {
            method,
            host: url.host,
            path: url.pathname,
            remoteAddress: socket.remoteAddress,
          },
          "http-proxy: non-GET request forced to GET (legacy wire behavior), request body dropped",
        );
      }
      // Block SSRF before we relay anything, even though the target is
      // routed through our own legacy handler (which now also blocks
      // private hosts) — defense-in-depth keeps both layers honest.
      if (isPrivateHost(url.host)) {
        this.opts.logger.warn(
          { host: url.host, remoteAddress: socket.remoteAddress },
          "http-proxy HTTP rejected: private/loopback target",
        );
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      // Pin to the standard web ports. Without this the HTTP path is an open
      // relay to any public host:port (25, 465, 6667, 22, …), the same
      // relay-abuse case the CONNECT path rules out — keep the two symmetric.
      const targetPort = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
      if (targetPort !== 80 && targetPort !== 443) {
        this.opts.logger.warn(
          {
            host: url.host,
            port: targetPort,
            remoteAddress: socket.remoteAddress,
          },
          "http-proxy HTTP rejected: non-standard port (only 80/443 allowed)",
        );
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      // Note: we deliberately do NOT add `url.host` to `knownHosts` —
      // self-allow-listing would let an indexer escape the static
      // CONNECT allow-list by first making an HTTP request.

      const apiKey = this.opts.state.settings.appApiKey || "_";
      const modified = `http://127.0.0.1:${this.opts.appPort}/${encodeURIComponent(apiKey)}/${url.host}${url.pathname}${url.search}`;
      const userAgent = matchHeader(headerStr, "User-Agent") ?? this.opts.state.settings.userAgent;

      const { statusCode, headers, body } = await undiciRequest(modified, {
        method: "GET",
        headers: { "User-Agent": userAgent },
        bodyTimeout: 60_000,
        headersTimeout: 30_000,
      });

      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(c as Buffer);
      const buf = Buffer.concat(chunks);
      const contentType = String(headers["content-type"] ?? "application/xml");
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

      socket.write(
        `HTTP/1.1 ${statusCode} ${statusCode < 400 ? "OK" : "Error"}\r\n` +
          `Content-Type: ${contentType}\r\n` +
          `Content-Length: ${buf.length}\r\n` +
          `Connection: close\r\n\r\n`,
      );
      socket.write(buf);
      socket.end();

      const ctx = {
        host: url.host,
        path: url.pathname,
        status: statusCode,
        bytes: buf.length,
        durationMs: Math.round(durationMs),
      };
      if (statusCode >= 500) {
        this.opts.logger.error(ctx, "http-proxy upstream 5xx");
      } else if (statusCode >= 400) {
        this.opts.logger.warn(ctx, "http-proxy upstream 4xx");
      } else {
        this.opts.logger.debug(ctx, "http-proxy ok");
      }
    } catch (err) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.opts.logger.error(
        {
          err,
          firstLine: redactApiKey(firstLine),
          host: url?.host ?? null,
          path: url?.pathname ?? null,
          durationMs: Math.round(durationMs),
        },
        "http-proxy HTTP error",
      );
      try {
        socket.end("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      } catch {
        /* ignore */
      }
    }
  }
}

interface InitialReadResult {
  headerStr: string;
  full: Buffer;
}

async function readUntilHeaders(socket: net.Socket): Promise<InitialReadResult | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };

    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > 64 * 1024) {
        cleanup();
        resolve(null);
        return;
      }
      const buf = Buffer.concat(chunks);
      const idx = buf.indexOf("\r\n\r\n");
      if (idx >= 0) {
        cleanup();
        resolve({ headerStr: buf.slice(0, idx).toString("ascii"), full: buf });
      }
    };

    const onError = (): void => {
      cleanup();
      resolve(null);
    };
    const onEnd = (): void => {
      cleanup();
      resolve(null);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

function matchHeader(headerStr: string, name: string): string | null {
  const lines = headerStr.split("\r\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    if (line.slice(0, idx).trim().toLowerCase() === name.toLowerCase()) {
      return line.slice(idx + 1).trim();
    }
  }
  return null;
}
