import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetting, mockPlugin } = vi.hoisted(() => ({
  mockSetting: { findUnique: vi.fn() },
  mockPlugin: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: { setting: mockSetting, plugin: mockPlugin },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => ({ settings: { userAgent: "UA" }, reloadSettings: vi.fn() }),
}));

import { setupRoutes } from "@/server/routes/admin/setup";

// Production registers @fastify/rate-limit globally (global: false) and the
// setup routes opt in via per-route config. The other setup-route unit test
// skips the plugin, so this file is the one place the actual throttle runs.
async function buildRateLimitedApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { global: false, max: 60, timeWindow: "1 minute" });
  await setupRoutes(app);
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  mockSetting.findUnique.mockReset();
  // setupComplete=false: the steady state the Web-UI proxy polls on every
  // page render before the wizard is finished.
  mockSetting.findUnique.mockResolvedValue(null);
  app = await buildRateLimitedApp();
});

afterEach(async () => {
  await app.close();
});

describe("setup-status rate limit", () => {
  // SETUP_RATE_LIMIT.max is 20 per 5 minutes; well above that here.
  const HITS = 30;

  it("never throttles the trusted loopback caller (the co-hosted Web-UI proxy)", async () => {
    // Regression guard for the 1.2.4 outage: the Next.js proxy polls
    // setup-status on every page render from 127.0.0.1. When that caller is
    // throttled it 429s, the proxy reads setupComplete=false, and every user
    // is redirected back into the setup wizard.
    const codes: number[] = [];
    for (let i = 0; i < HITS; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/auth/setup-status",
        remoteAddress: "127.0.0.1",
      });
      codes.push(r.statusCode);
    }
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it("still throttles a direct external (non-loopback) caller", async () => {
    // Fastify's port can be exposed directly; an unauthenticated visitor that
    // bypasses the proxy must still hit the limit.
    const codes: number[] = [];
    for (let i = 0; i < HITS; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/auth/setup-status",
        remoteAddress: "203.0.113.7",
      });
      codes.push(r.statusCode);
    }
    expect(codes).toContain(429);
  });
});
