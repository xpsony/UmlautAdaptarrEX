import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

type AuthCookies = typeof import("@/server/routes/admin/_auth-cookies");

function req(protocol: "http" | "https"): FastifyRequest {
  return { protocol } as unknown as FastifyRequest;
}

// IS_PROD is evaluated when the module first loads, so each test resets
// the module registry and dynamically re-imports after stubbing NODE_ENV.
async function loadWithEnv(env: string): Promise<AuthCookies> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env);
  return import("@/server/routes/admin/_auth-cookies");
}

describe("auth cookie options", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("marks cookies Secure when the request arrived over HTTPS", async () => {
    const { sessionCookieOptions, csrfCookieOptions } =
      await loadWithEnv("production");
    expect(sessionCookieOptions(req("https"), 1000).secure).toBe(true);
    expect(csrfCookieOptions(req("https")).secure).toBe(true);
  });

  it("does not mark cookies Secure for plain HTTP, even in production", async () => {
    // Self-hosted deployments commonly run over plain HTTP on a LAN. A
    // hard `Secure` flag here would mean the browser silently drops the
    // cookie on the next request and the user sees an instant
    // "Session expired" after login.
    const { sessionCookieOptions, csrfCookieOptions } =
      await loadWithEnv("production");
    expect(sessionCookieOptions(req("http"), 1000).secure).toBe(false);
    expect(csrfCookieOptions(req("http")).secure).toBe(false);
  });

  it("honors req.protocol in development as well", async () => {
    const { sessionCookieOptions } = await loadWithEnv("development");
    expect(sessionCookieOptions(req("http"), 1000).secure).toBe(false);
    expect(sessionCookieOptions(req("https"), 1000).secure).toBe(true);
  });
});
