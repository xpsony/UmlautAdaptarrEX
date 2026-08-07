import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/middleware", () => ({
  requireAuth: async () => {
    /* no-op preHandler for unit tests */
  },
}));

import { systemRoutes } from "@/server/routes/admin/system";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await systemRoutes(app);
  await app.ready();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await app.close();
});

describe("systemRoutes", () => {
  it("GET /system/capabilities reflects the supervisor env var", async () => {
    vi.stubEnv("UMLAUTADAPTARREX_SUPERVISED", "1");
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/system/capabilities",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ canRestart: true });
  });

  it("GET /system/capabilities returns canRestart=false outside the supervisor", async () => {
    vi.stubEnv("UMLAUTADAPTARREX_SUPERVISED", "");
    const r = await app.inject({
      method: "GET",
      url: "/api/admin/system/capabilities",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ canRestart: false });
  });

  it("POST /system/restart returns 202 with the supervisor flag and exit code", async () => {
    vi.stubEnv("UMLAUTADAPTARREX_SUPERVISED", "1");
    // Observe the supervisor hand-off instead of stubbing global.setTimeout:
    // a blunt setTimeout stub swallows avvio's internal ready-timeout timer
    // (scheduled on nextTick since avvio 9.3.0) and deadlocks app.close().
    // The emit is harmless here — nothing in this worker listens for it
    // except this test.
    const emitted = vi.fn();
    (process as NodeJS.EventEmitter).once("umlautadaptarrex:restart", emitted);

    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/admin/system/restart",
      });
      expect(r.statusCode).toBe(202);
      const body = r.json() as {
        ok: boolean;
        supervised: boolean;
        exitCode: number;
      };
      expect(body).toEqual({ ok: true, supervised: true, exitCode: 75 });
      // Teardown fires once the 202 has flushed (response "finish"); the
      // route's 1s fallback timer covers the case where it never does.
      await vi.waitFor(() => expect(emitted).toHaveBeenCalledTimes(1), {
        timeout: 3000,
      });
    } finally {
      (process as NodeJS.EventEmitter).removeListener("umlautadaptarrex:restart", emitted);
    }
  });
});
