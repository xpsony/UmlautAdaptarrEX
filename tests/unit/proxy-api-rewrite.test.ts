import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRewrittenUrl, isRewrite } from "next/experimental/testing/server";

// Regression for the standalone-mode port bug: API reverse-proxying used to
// live in `next.config.ts` rewrites, whose destinations are baked into
// routes-manifest.json at build time — freezing the API port at the
// build-time default (:5005) and ignoring the runtime API_UPSTREAM. The
// proxy must instead resolve the upstream per request so a changed
// UMLAUTADAPTARREX_LEGACYAPI_PORT / PORT (surfaced as API_UPSTREAM) is honored.

const originalUpstream = process.env.API_UPSTREAM;

async function loadProxy(upstream: string) {
  process.env.API_UPSTREAM = upstream;
  vi.resetModules();
  return (await import("@/proxy")).proxy;
}

afterEach(() => {
  if (originalUpstream === undefined) delete process.env.API_UPSTREAM;
  else process.env.API_UPSTREAM = originalUpstream;
  vi.resetModules();
});

describe("proxy API reverse-proxy", () => {
  it("rewrites /api/health to the runtime-configured upstream port", async () => {
    const proxy = await loadProxy("http://127.0.0.1:8080");
    const res = await proxy(new NextRequest("http://ui.example/api/health"));

    expect(isRewrite(res)).toBe(true);
    expect(getRewrittenUrl(res)).toBe("http://127.0.0.1:8080/api/health");
  });

  it("preserves the query string when rewriting /api/admin/*", async () => {
    const proxy = await loadProxy("http://127.0.0.1:8080");
    const res = await proxy(
      new NextRequest("http://ui.example/api/admin/instances?sync=true&page=2"),
    );

    expect(isRewrite(res)).toBe(true);
    expect(getRewrittenUrl(res)).toBe("http://127.0.0.1:8080/api/admin/instances?sync=true&page=2");
  });

  it("tracks a different upstream port without a rebuild", async () => {
    const proxy = await loadProxy("http://127.0.0.1:9090");
    const res = await proxy(new NextRequest("http://ui.example/api/auth/me"));

    expect(getRewrittenUrl(res)).toBe("http://127.0.0.1:9090/api/auth/me");
  });
});
