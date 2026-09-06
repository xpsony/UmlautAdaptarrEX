import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import type { AppState } from "@/server/state";

// Focused coverage for the handleHttp timeout-wiring fix: bodyTimeout and
// headersTimeout must both be derived from indexerTimeoutSeconds via
// `ceil(T * 1.75) * 1000 + 5_000` (the legacy route buffers its whole
// response, so headers only arrive once the search - worst case ~1.75×T -
// completes; a 30s headersTimeout cap would make the fix a no-op).
//
// undici is mocked so the exact options object passed to `request()` can be
// asserted directly, instead of inferring the timeout from a real slow
// response (flaky and slow). This is a separate file from
// http-proxy-http.test.ts on purpose - that suite relies on undici actually
// performing the HTTP round-trip against its fake app server, which a
// file-wide `vi.mock("undici", ...)` would break.
const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
}));

vi.mock("undici", () => ({
  request: mockRequest,
}));

const { HttpProxyServer } = await import("@/server/proxy/http-proxy");

function buildState(indexerTimeoutSeconds: number): AppState {
  return {
    settings: {
      appApiKey: "test-key",
      proxyPort: 0,
      proxyUsername: "",
      proxyPassword: "",
      userAgent: "UmlautAdaptarrEX/test",
      indexerTimeoutSeconds,
    },
  } as unknown as AppState;
}

function captureLogger(): pino.Logger {
  return pino({ level: "silent" }, { write: () => {} });
}

async function startProxy(state: AppState): Promise<{ port: number; stop: () => Promise<void> }> {
  // Same free-port retry dance as the other http-proxy unit suites: the
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
      appPort: 1, // never dialed for real - undiciRequest is mocked.
      state,
      logger: captureLogger(),
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

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({
    statusCode: 200,
    headers: { "content-type": "application/xml" },
    body: (async function* () {
      yield Buffer.from("<ok/>");
    })(),
  });
});

describe("http-proxy handleHttp timeout wiring", () => {
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;

  afterEach(async () => {
    await proxy?.stop();
  });

  it("budgets 40_000ms for a 20s indexer timeout (ceil(20*1.75)*1000 + 5_000)", async () => {
    proxy = await startProxy(buildState(20));
    await sendRawRequest(
      proxy.port,
      "GET http://indexer.example.com/api?t=search HTTP/1.1\r\nHost: indexer.example.com\r\n\r\n",
    );

    expect(mockRequest).toHaveBeenCalledOnce();
    const opts = mockRequest.mock.calls[0]?.[1] as { bodyTimeout: number; headersTimeout: number };
    expect(opts.bodyTimeout).toBe(40_000);
    expect(opts.headersTimeout).toBe(40_000);
  });

  it("budgets 110_000ms for the default 60s indexer timeout (ceil(60*1.75)*1000 + 5_000)", async () => {
    proxy = await startProxy(buildState(60));
    await sendRawRequest(
      proxy.port,
      "GET http://indexer.example.com/api?t=search HTTP/1.1\r\nHost: indexer.example.com\r\n\r\n",
    );

    expect(mockRequest).toHaveBeenCalledOnce();
    const opts = mockRequest.mock.calls[0]?.[1] as { bodyTimeout: number; headersTimeout: number };
    expect(opts.bodyTimeout).toBe(110_000);
    expect(opts.headersTimeout).toBe(110_000);
  });
});
