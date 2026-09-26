import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import { testConnection } from "@/arr/test-connection";

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => data,
      text: async () => JSON.stringify(data),
    },
  };
}

beforeEach(() => {
  requestMock.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("testConnection", () => {
  it("rejects a Prowlarr-masked api key without making an HTTP call", async () => {
    const r = await testConnection(
      "sonarr",
      "http://sonarr.local",
      "*".repeat(32),
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("masked_api_key");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("blocks private hosts when strict mode is enabled", async () => {
    vi.stubEnv("UA_BLOCK_PRIVATE_INSTANCE_HOSTS", "true");
    const r = await testConnection(
      "sonarr",
      "http://192.168.1.5",
      "real-key-1234",
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("private_host_blocked");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("allows private hosts by default (self-hosted shape)", async () => {
    vi.stubEnv("UA_BLOCK_PRIVATE_INSTANCE_HOSTS", "");
    requestMock.mockResolvedValueOnce(jsonResponse({ version: "4.0.5.1234" }));
    const r = await testConnection(
      "sonarr",
      "http://192.168.1.5",
      "real-key-1234",
    );
    expect(r.ok).toBe(true);
    expect(r.version).toBe("4.0.5.1234");
  });

  it("uses /api/v3 for sonarr/radarr and /api/v1 otherwise", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({}));
    await testConnection("sonarr", "http://x", "k");
    expect(requestMock.mock.calls[0]?.[0] as string).toContain("/api/v3/");

    requestMock.mockResolvedValueOnce(jsonResponse({}));
    await testConnection("lidarr", "http://x", "k");
    expect(requestMock.mock.calls[1]?.[0] as string).toContain("/api/v1/");
  });

  it("returns upstream_unauthorized for 401", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ error: "auth" }, 401));
    const r = await testConnection("sonarr", "http://x", "k");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("upstream_unauthorized");
    expect(r.status).toBe(401);
  });

  it("returns upstream_error for other 4xx/5xx codes", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ err: "x" }, 502));
    const r = await testConnection("sonarr", "http://x", "k");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("upstream_error");
    expect(r.status).toBe(502);
  });

  it("returns network on a connection failure", async () => {
    requestMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await testConnection("sonarr", "http://nope", "k");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("network");
    expect(typeof r.error).toBe("string");
  });

  it("returns ok with the version on a 2xx response", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({ version: "1.2.3" }));
    const r = await testConnection("sonarr", "http://x", "k");
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.version).toBe("1.2.3");
  });

  it("encodes the api key into the URL safely", async () => {
    requestMock.mockResolvedValueOnce(jsonResponse({}));
    await testConnection("radarr", "http://x", "key with spaces & symbols");
    const url = requestMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("apikey=key%20with%20spaces%20%26%20symbols");
  });
});

describe("testConnection for listenarr", () => {
  it("calls system/info with the key in the header", async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      body: { json: async () => ({ version: "1.2.3" }), text: async () => "{}" },
    });

    const res = await testConnection("listenarr", "http://listenarr.local", "listenarr-key");

    const url = requestMock.mock.calls[0]?.[0] as string;
    const args = requestMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(url).toBe("http://listenarr.local/api/v1/system/info");
    expect(args.headers["X-Api-Key"]).toBe("listenarr-key");
    expect(url).not.toContain("listenarr-key");
    expect(res.ok).toBe(true);
    expect(res.version).toBe("1.2.3");
  });

  it("reports a rejected key as upstream_unauthorized", async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 401,
      body: { text: async () => "Unauthorized", json: async () => null },
    });

    const res = await testConnection("listenarr", "http://listenarr.local", "wrong-key");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("upstream_unauthorized");
  });

  it("still puts the key in the query for the other arrs", async () => {
    requestMock.mockResolvedValueOnce({
      statusCode: 200,
      body: { json: async () => ({ version: "4.0.0" }), text: async () => "{}" },
    });

    await testConnection("sonarr", "http://sonarr.local", "sonarr-key");
    const url = requestMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/v3/system/status?apikey=sonarr-key");
  });
});
