import net from "node:net";
import { Readable } from "node:stream";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const undiciMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => undiciMock(...args),
}));

import { HttpProxyServer } from "@/server/proxy/http-proxy";
import type { AppLogger } from "@/server/logging/logger";
import type { AppState } from "@/server/state";

interface FakeSettings {
  appApiKey: string;
  proxyUsername: string;
  proxyPassword: string;
  userAgent: string;
}

function makeFakeState(overrides: Partial<FakeSettings> = {}): AppState {
  return {
    settings: {
      appApiKey: "app-key",
      proxyUsername: "ua-user",
      proxyPassword: "ua-secret",
      userAgent: "UmlautAdaptarr/2.0",
      ...overrides,
    },
  } as unknown as AppState;
}

function makeNoopLogger(): AppLogger {
  const logger: AppLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
    level: "info",
  } as unknown as AppLogger;
  return logger;
}

async function bookEphemeralPort(): Promise<number> {
  const tmp = net.createServer();
  const port = await new Promise<number>((resolve) => {
    tmp.listen(0, "127.0.0.1", () => {
      const addr = tmp.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else resolve(0);
    });
  });
  await new Promise<void>((resolve) => tmp.close(() => resolve()));
  return port;
}

interface ProxyRequest {
  port: number;
  payload: string;
}

async function sendRaw({ port, payload }: ProxyRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    sock.on("data", (chunk: Buffer) => chunks.push(chunk));
    sock.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    sock.on("error", reject);
    sock.write(payload);
  });
}

interface RunningProxy {
  server: HttpProxyServer;
  port: number;
}

const running = new Set<RunningProxy>();

async function startProxy(
  state: AppState = makeFakeState(),
): Promise<RunningProxy> {
  const port = await bookEphemeralPort();
  const server = new HttpProxyServer({
    port,
    appPort: 0,
    state,
    logger: makeNoopLogger(),
  });
  await server.start();
  const entry = { server, port };
  running.add(entry);
  return entry;
}

beforeEach(() => {
  undiciMock.mockReset();
});

afterEach(async () => {
  // Race against a short timeout so a leftover keep-alive socket doesn't
  // hang the test process. The proxy's net.Server.close() can stall briefly
  // after a client closed if its kernel-side state is still draining.
  for (const entry of running) {
    await Promise.race([
      entry.server.stop(),
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
    ]);
  }
  running.clear();
});

afterAll(() => {
  for (const entry of running) {
    void entry.server.stop();
  }
  running.clear();
});

beforeAll(() => {
  // No-op; here so the test file follows the same lifecycle shape as the
  // other API tests.
});

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

function streamingUndiciResponse(body: string, statusCode = 200): unknown {
  return {
    statusCode,
    headers: { "content-type": "application/xml" },
    body: Readable.from([Buffer.from(body)]),
  };
}

describe("Proxy-Auth gate", () => {
  it("returns 407 with Proxy-Authenticate when no header is sent", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "GET http://indexer.example/api?t=caps HTTP/1.1\r\n" +
        "Host: indexer.example\r\n" +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 407");
    expect(response).toContain('Proxy-Authenticate: Basic realm="Proxy"');
    // No upstream call should fire when auth fails.
    expect(undiciMock).not.toHaveBeenCalled();
  });

  it("returns 407 when the credentials are wrong", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "GET http://indexer.example/api?t=caps HTTP/1.1\r\n" +
        "Host: indexer.example\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "wrong-password")}\r\n` +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 407");
    expect(undiciMock).not.toHaveBeenCalled();
  });

  it("forwards the request when credentials are correct", async () => {
    const { port } = await startProxy();
    undiciMock.mockResolvedValueOnce(streamingUndiciResponse("<rss/>"));

    const response = await sendRaw({
      port,
      payload:
        "GET http://indexer.example/api?t=caps HTTP/1.1\r\n" +
        "Host: indexer.example\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });

    expect(response).toContain("HTTP/1.1 200");
    expect(response).toContain("<rss/>");
    expect(undiciMock).toHaveBeenCalledOnce();
    // The proxy rewrites the URL to point at our internal legacy handler:
    //   http://127.0.0.1:{appPort}/{appApiKey}/{host}{path}
    const url = undiciMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/app-key/indexer.example/api?t=caps");
  });

  it("disables auth entirely when proxyPassword is empty (legacy behavior)", async () => {
    const { port } = await startProxy(makeFakeState({ proxyPassword: "" }));
    undiciMock.mockResolvedValueOnce(streamingUndiciResponse("<rss/>"));

    const response = await sendRaw({
      port,
      payload:
        "GET http://indexer.example/api?t=caps HTTP/1.1\r\n" +
        "Host: indexer.example\r\n" +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 200");
    expect(undiciMock).toHaveBeenCalledOnce();
  });
});

describe("HTTP forwarding (handleHttp)", () => {
  it("rejects 403 when the target host is private (SSRF guard)", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "GET http://10.0.0.5/admin HTTP/1.1\r\n" +
        "Host: 10.0.0.5\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 403");
    expect(undiciMock).not.toHaveBeenCalled();
  });

  it("forwards the User-Agent header verbatim when the client supplies one", async () => {
    const { port } = await startProxy();
    undiciMock.mockResolvedValueOnce(streamingUndiciResponse("<rss/>"));

    await sendRaw({
      port,
      payload:
        "GET http://indexer.example/api HTTP/1.1\r\n" +
        "Host: indexer.example\r\n" +
        "User-Agent: Sonarr/4.0.5\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });

    const args = undiciMock.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(args.headers["User-Agent"]).toBe("Sonarr/4.0.5");
  });

  it("falls back to the configured User-Agent when client omits the header", async () => {
    const { port } = await startProxy();
    undiciMock.mockResolvedValueOnce(streamingUndiciResponse("<rss/>"));

    await sendRaw({
      port,
      payload:
        "GET http://indexer.example/api HTTP/1.1\r\n" +
        "Host: indexer.example\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });
    const args = undiciMock.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(args.headers["User-Agent"]).toBe("UmlautAdaptarr/2.0");
  });

  it("uses the underscore sentinel api key when appApiKey is empty", async () => {
    const { port } = await startProxy(makeFakeState({ appApiKey: "" }));
    undiciMock.mockResolvedValueOnce(streamingUndiciResponse("<rss/>"));

    await sendRaw({
      port,
      payload:
        "GET http://indexer.example/api HTTP/1.1\r\n" +
        "Host: indexer.example\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });

    const url = undiciMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/_/indexer.example/api");
  });

  it("returns 500 on a malformed request line", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "GARBAGE\r\n" +
        "Host: indexer.example\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });
    // No URL → the catch path returns 500 (URL parser throws) or 400
    // (split returns no urlStr). Both indicate the proxy detected the bad
    // input rather than blindly forwarding it.
    expect(response).toMatch(/HTTP\/1\.1 (400|500)/);
    expect(undiciMock).not.toHaveBeenCalled();
  });
});

describe("CONNECT tunnel allow-list", () => {
  it("rejects CONNECTs to private addresses", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "CONNECT 10.0.0.5:443 HTTP/1.1\r\n" +
        "Host: 10.0.0.5:443\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 403");
  });

  it("rejects CONNECTs to hosts not on the static allow-list", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "CONNECT random-host.example:443 HTTP/1.1\r\n" +
        "Host: random-host.example:443\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 403");
  });

  it("rejects CONNECTs to allow-listed hosts on a non-443 port", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "CONNECT prowlarr.servarr.com:8080 HTTP/1.1\r\n" +
        "Host: prowlarr.servarr.com:8080\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 403");
  });

  it("returns 400 on a CONNECT line with no host", async () => {
    const { port } = await startProxy();
    const response = await sendRaw({
      port,
      payload:
        "CONNECT  HTTP/1.1\r\n" +
        "Host:\r\n" +
        `Proxy-Authorization: ${basicAuth("ua-user", "ua-secret")}\r\n` +
        "\r\n",
    });
    expect(response).toContain("HTTP/1.1 400");
  });
});
