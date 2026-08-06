import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { HttpProxyServer } from "@/server/proxy/http-proxy";
import type { AppState } from "@/server/state";

// First coverage for the plain-HTTP path of the proxy (handleHttp) — the
// CONNECT and watchdog paths have their own suites. The proxy rewrites
// requests to http://127.0.0.1:{appPort}/{apiKey}/{host}{path}, so the
// "app" here is a local capture server standing in for Fastify.

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

function buildState(): AppState {
  return {
    settings: {
      appApiKey: "test-key",
      proxyPort: 0,
      proxyUsername: "",
      proxyPassword: "",
      cacheDurationMinutes: 12,
      titleApiHost: "https://example.invalid",
      tmdbApiKey: null,
      userAgent: "UmlautAdaptarrEX/test",
      setupComplete: true,
      logRetentionDays: 3,
      indexerRateLimitMs: 500,
      operationMode: "proxy",
      blockPrivateInstanceHosts: false,
    },
  } as unknown as AppState;
}

function captureLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write: (s: string) => {
        lines.push(s);
      },
    },
  );
  return { logger, lines };
}

async function startFakeApp(): Promise<{
  port: number;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/xml" });
      res.end("<ok/>");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  return {
    port: addr.port,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function startProxy(
  appPort: number,
  logger: pino.Logger,
): Promise<{ port: number; stop: () => Promise<void> }> {
  // Same free-port retry dance as http-proxy-connect.test.ts: the
  // close→rebind window is racy under parallel vitest workers.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const addr = probe.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const port = addr.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const proxy = new HttpProxyServer({
      port,
      appPort,
      state: buildState(),
      logger,
    });
    try {
      await proxy.start();
      return { port, stop: () => proxy.stop() };
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw lastErr;
}

function sendRawRequest(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    let buf = "";
    sock.setTimeout(5000, () => sock.destroy(new Error("timeout")));
    sock.on("connect", () => sock.write(raw));
    sock.on("data", (c) => {
      buf += c.toString("utf8");
    });
    sock.on("close", () => resolve(buf));
    sock.on("error", reject);
  });
}

describe("http-proxy plain-HTTP path", () => {
  let app: Awaited<ReturnType<typeof startFakeApp>> | undefined;
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
  let log: ReturnType<typeof captureLogger>;

  beforeEach(async () => {
    app = await startFakeApp();
    log = captureLogger();
    proxy = await startProxy(app.port, log.logger);
  });

  afterEach(async () => {
    // Guard against beforeEach throwing partway through (e.g. startProxy
    // exhausting its EADDRINUSE retries) — proxy could be undefined while
    // app is set, and vitest still runs afterEach in that case. Without the
    // optional chaining, an unguarded proxy.stop() throw would skip
    // app.close(), leaking the fake HTTP server's socket.
    await proxy?.stop();
    await app?.close();
  });

  it("relays a GET as GET to the rewritten legacy URL", async () => {
    const response = await sendRawRequest(
      proxy!.port,
      "GET http://indexer.example.com/api?t=search&q=abc HTTP/1.1\r\n" +
        "Host: indexer.example.com\r\n\r\n",
    );
    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("<ok/>");
    expect(app!.requests).toHaveLength(1);
    expect(app!.requests[0]!.method).toBe("GET");
    expect(app!.requests[0]!.url).toBe("/test-key/indexer.example.com/api?t=search&q=abc");
  });

  it("forces POST to GET (legacy wire behavior) and warns about it", async () => {
    const response = await sendRawRequest(
      proxy!.port,
      "POST http://indexer.example.com/api?t=search HTTP/1.1\r\n" +
        "Host: indexer.example.com\r\n" +
        "Content-Type: application/x-www-form-urlencoded\r\n" +
        "Content-Length: 9\r\n\r\n" +
        "q=test123",
    );
    expect(response).toContain("HTTP/1.1 200 OK");
    expect(app!.requests).toHaveLength(1);
    // Documented legacy compat: the .NET predecessor forced GET too.
    expect(app!.requests[0]!.method).toBe("GET");
    expect(app!.requests[0]!.body).toBe("");
    const warned = log.lines.some((l) => l.includes("non-GET") && l.includes('"POST"'));
    expect(warned).toBe(true);
  });
});
