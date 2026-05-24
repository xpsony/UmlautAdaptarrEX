import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisabledProxyStubServer } from "@/server/proxy/disabled-stub";

interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
}

function makeLogger(): MockLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
}

let stub: DisabledProxyStubServer | null = null;

beforeEach(() => {
  stub = null;
});

afterEach(async () => {
  if (stub) {
    // server.close() in Node only resolves once every accepted socket is
    // fully released, which can lag for a moment after the client closes.
    // Race against a short timeout so the test doesn't hang on cleanup.
    await Promise.race([
      stub.stop(),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  }
  stub = null;
});

async function listenOnEphemeralPort(): Promise<{
  server: DisabledProxyStubServer;
  port: number;
}> {
  // Pick an ephemeral port by booking and releasing one.
  const tmp = net.createServer();
  const port = await new Promise<number>((resolve) => {
    tmp.listen(0, () => {
      const addr = tmp.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else resolve(0);
    });
  });
  await new Promise<void>((resolve) => tmp.close(() => resolve()));

  const logger = makeLogger();
  const server = new DisabledProxyStubServer({ port, logger: logger as never });
  await server.start();
  return { server, port };
}

describe("DisabledProxyStubServer", () => {
  it("responds with 503 and a German service-disabled message to every connection", async () => {
    const booted = await listenOnEphemeralPort();
    stub = booted.server;

    const response = await new Promise<string>((resolve, reject) => {
      const sock = net.createConnection(booted.port, "127.0.0.1");
      const chunks: Buffer[] = [];
      sock.on("data", (chunk: Buffer) => chunks.push(chunk));
      // Use the `close` event (fires once both ends are fully closed) so
      // the test only resolves when the connection is actually gone.
      sock.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
      sock.on("error", reject);
      sock.write("GET / HTTP/1.1\r\n\r\n");
    });

    expect(response).toContain("HTTP/1.1 503");
    expect(response).toContain("Connection: close");
    expect(response.toLowerCase()).toContain("content-type: text/plain");
    expect(response).toContain("Proxy Server deaktiviert");
  }, 15_000);

  it("stop() before start() is a safe no-op", async () => {
    const fresh = new DisabledProxyStubServer({
      port: 0,
      logger: makeLogger() as never,
    });
    await expect(fresh.stop()).resolves.toBeUndefined();
  });
});
