import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { HttpProxyServer } from "@/server/proxy/http-proxy";
import type { AppState } from "@/server/state";

// We exercise the public TCP surface of HttpProxyServer rather than calling
// private methods, so the test catches any future regression that leaves
// `net.connect` reachable for non-allow-listed CONNECT targets — which is the
// open-relay case we just closed.

interface ProxyHandle {
  proxy: HttpProxyServer;
  port: number;
  stop: () => Promise<void>;
}

function buildState(overrides: Partial<AppState["settings"]> = {}): AppState {
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
      ...overrides,
    },
  } as unknown as AppState;
}

async function grabFreePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const addr = probe.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  const port = addr.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function startProxy(state: AppState): Promise<ProxyHandle> {
  // Grab a free ephemeral port, close the probe, then bind the proxy on that
  // port number. The close→rebind window is racy under parallel vitest
  // workers (another worker can claim the port in between), so retry with a
  // fresh port on EADDRINUSE instead of failing the test.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await grabFreePort();
    const proxy = new HttpProxyServer({
      port,
      appPort: 1, // unused — these tests never reach handleHttp.
      state,
      logger: pino({ level: "silent" }),
    });
    try {
      await proxy.start();
      return { proxy, port, stop: () => proxy.stop() };
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw lastErr;
}

function sendConnectAndReadStatusLine(port: number, connectLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    let buf = "";
    sock.setTimeout(2000, () => {
      sock.destroy(new Error("timeout waiting for response"));
    });
    sock.on("connect", () => {
      sock.write(`${connectLine}\r\nHost: ${connectLine.split(" ")[1]}\r\n\r\n`);
    });
    sock.on("data", (chunk) => {
      buf += chunk.toString("ascii");
      const idx = buf.indexOf("\r\n");
      if (idx >= 0) {
        sock.destroy();
        resolve(buf.slice(0, idx));
      }
    });
    sock.on("error", reject);
    sock.on("close", () => {
      if (!buf) reject(new Error("connection closed without response"));
    });
  });
}

describe("http-proxy CONNECT allow-list", () => {
  let handle: ProxyHandle;

  beforeEach(async () => {
    handle = await startProxy(buildState());
  });

  afterEach(async () => {
    await handle.stop();
  });

  it("rejects unknown host with 403", async () => {
    const status = await sendConnectAndReadStatusLine(
      handle.port,
      "CONNECT example.com:443 HTTP/1.1",
    );
    expect(status).toBe("HTTP/1.1 403 Forbidden");
  });

  it("rejects allow-listed host on non-443 port with 403", async () => {
    const status = await sendConnectAndReadStatusLine(
      handle.port,
      "CONNECT prowlarr.servarr.com:25 HTTP/1.1",
    );
    expect(status).toBe("HTTP/1.1 403 Forbidden");
  });

  it("rejects loopback CONNECT with 403 (private-host guard still wins first)", async () => {
    const status = await sendConnectAndReadStatusLine(
      handle.port,
      "CONNECT 127.0.0.1:443 HTTP/1.1",
    );
    expect(status).toBe("HTTP/1.1 403 Forbidden");
  });

  it("rejects ambiguous numeric loopback (decimal-32) with 403", async () => {
    // 2130706433 == 127.0.0.1; isPrivateHost flags it as ambiguous-numeric.
    const status = await sendConnectAndReadStatusLine(
      handle.port,
      "CONNECT 2130706433:443 HTTP/1.1",
    );
    expect(status).toBe("HTTP/1.1 403 Forbidden");
  });
});

describe("http-proxy auth gating (regression: empty password ≠ open proxy)", () => {
  // This describes today's behaviour: when proxyPassword is empty, no auth
  // is enforced. The CONNECT allow-list above is what keeps that from being
  // an open relay. If the auth-on-empty-password policy changes (Layer 2),
  // update this test alongside the new behaviour.
  let handle: ProxyHandle;

  beforeEach(async () => {
    handle = await startProxy(
      buildState({
        proxyUsername: "UmlautAdaptarr",
        proxyPassword: "",
      }),
    );
  });

  afterEach(async () => {
    await handle.stop();
  });

  it("does not return 407 when password is empty (auth skipped)", async () => {
    const status = await sendConnectAndReadStatusLine(
      handle.port,
      "CONNECT example.com:443 HTTP/1.1",
    );
    // Hits the allow-list 403, not 407. Confirms auth is bypassed —
    // documented as part of the limitation we're explicitly mitigating
    // with the CONNECT allow-list until Layer 2 lands.
    expect(status).toBe("HTTP/1.1 403 Forbidden");
  });
});
