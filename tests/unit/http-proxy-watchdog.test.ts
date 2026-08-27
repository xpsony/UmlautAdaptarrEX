import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { HttpProxyServer } from "@/server/proxy/http-proxy";
import type { AppState } from "@/server/state";

// The watchdog reacts to "close" and "error" on the underlying net.Server.
// These tests simulate an unexpected listener death by closing the internal
// server directly (without going through HttpProxyServer.stop()) and verify
// the proxy rebinds on the same port. Accessing the private field via cast
// is the pragmatic compromise - the alternative would be exposing an
// internal-only hook just for tests.

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

async function reservePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const addr = probe.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  const port = addr.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function isListening(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("http-proxy watchdog", () => {
  let proxy: HttpProxyServer;
  let port: number;

  beforeEach(async () => {
    // The reserve→close→rebind window is racy under parallel vitest workers
    // (another worker can claim the port in between), so retry with a fresh
    // port on EADDRINUSE instead of failing the test - same pattern as
    // http-proxy-connect.test.ts / http-proxy-http.test.ts.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      port = await reservePort();
      proxy = new HttpProxyServer({
        port,
        appPort: 1,
        state: buildState(),
        logger: pino({ level: "silent" }),
      });
      try {
        await proxy.start();
        return;
      } catch (err) {
        lastErr = err;
        if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      }
    }
    throw lastErr;
  });

  afterEach(async () => {
    await proxy.stop();
  });

  it("rebinds after the underlying server dies unexpectedly", async () => {
    expect(await isListening(port, 500)).toBe(true);

    // Simulate unexpected death: close the internal listener without going
    // through HttpProxyServer.stop(). The "close" event should trigger the
    // watchdog, which schedules a rebind on the first backoff step (1s).
    const internal = (proxy as unknown as { server: net.Server }).server;
    await new Promise<void>((resolve) => internal.close(() => resolve()));

    expect(await isListening(port, 200)).toBe(false);

    // First backoff step is 1000ms. Give it generous headroom for CI jitter.
    const recovered = await waitFor(() => isListening(port, 200), 5_000);
    expect(recovered).toBe(true);
  });

  it("does not rebind after stop()", async () => {
    expect(await isListening(port, 500)).toBe(true);

    await proxy.stop();

    expect(await isListening(port, 200)).toBe(false);

    // Wait past the first backoff step and confirm no zombie rebind happened.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await isListening(port, 200)).toBe(false);
  });
});
