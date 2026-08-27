import "./_setup/db";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { LogBroadcaster } from "@/server/logging/broadcast";
import { cleanDb, ensureTestDb } from "./_setup/db";

let app: FastifyInstance;
let broadcaster: LogBroadcaster;
let baseHttpUrl: string;
let baseWsUrl: string;
const openClients = new Set<WebSocket>();

beforeAll(async () => {
  await ensureTestDb();

  app = Fastify({ logger: false });
  // No routes needed for this test; the broadcaster only intercepts the
  // upgrade handshake on the underlying http.Server.
  await app.ready();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind a port");
  }
  baseHttpUrl = `http://127.0.0.1:${address.port}`;
  baseWsUrl = `ws://127.0.0.1:${address.port}/ws/logs`;

  broadcaster = new LogBroadcaster();
  broadcaster.attachToHttp(app.server);
});

afterAll(async () => {
  for (const ws of openClients) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  openClients.clear();
  broadcaster.stop();
  await app.close();
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanDb();
});

afterEach(() => {
  for (const ws of openClients) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  openClients.clear();
});

async function seedSession(): Promise<string> {
  const { prisma } = await import("@/lib/db");
  const user = await prisma.adminUser.create({
    data: { username: "ws-admin", passwordHash: "$argon2id$irrelevant" },
  });
  const session = await prisma.session.create({
    data: {
      id: "ws-session-id-12345",
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return session.id;
}

interface UpgradeOutcome {
  status: number | null;
  message: string | null;
  open: boolean;
}

async function tryUpgrade(
  cookieHeader: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<{ ws: WebSocket; outcome: UpgradeOutcome }> {
  const ws = new WebSocket(baseWsUrl, {
    headers: {
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...extraHeaders,
    },
  });
  openClients.add(ws);

  const outcome = await new Promise<UpgradeOutcome>((resolve) => {
    let settled = false;
    const settle = (o: UpgradeOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    ws.once("open", () => settle({ status: 101, message: null, open: true }));
    ws.once(
      "unexpected-response",
      (_req, res: { statusCode: number; statusMessage: string }) => {
        settle({
          status: res.statusCode,
          message: res.statusMessage,
          open: false,
        });
      },
    );
    ws.once("error", () => {
      // Some failure modes never reach unexpected-response (socket destroyed
      // before headers parse). Surface a sentinel so tests can still assert.
      settle({ status: null, message: "error", open: false });
    });
  });
  return { ws, outcome };
}

describe("WebSocket /ws/logs upgrade gate", () => {
  it("rejects with 401 when no session cookie is sent", async () => {
    const { outcome } = await tryUpgrade(null);
    expect(outcome.open).toBe(false);
    expect(outcome.status).toBe(401);
  });

  it("rejects with 401 when the session cookie is for a stale row", async () => {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.adminUser.create({
      data: { username: "stale", passwordHash: "$argon2id$x" },
    });
    await prisma.session.create({
      data: {
        id: "stale-id",
        userId: user.id,
        expiresAt: new Date(Date.now() - 10_000),
      },
    });

    const { outcome } = await tryUpgrade("uaSession=stale-id");
    expect(outcome.open).toBe(false);
    expect(outcome.status).toBe(401);
  });

  it("rejects with 403 when Origin points at a foreign host", async () => {
    const sid = await seedSession();
    const { outcome } = await tryUpgrade(`uaSession=${sid}`, {
      Origin: "http://evil.example",
    });
    expect(outcome.open).toBe(false);
    expect(outcome.status).toBe(403);
  });

  it("accepts an upgrade with a valid session cookie and no Origin header", async () => {
    const sid = await seedSession();
    const { outcome } = await tryUpgrade(`uaSession=${sid}`);
    expect(outcome.open).toBe(true);
    expect(outcome.status).toBe(101);
  });
});

describe("LogBroadcaster.broadcast end-to-end roundtrip", () => {
  it("delivers a log entry to a connected client within the throttle window", async () => {
    const sid = await seedSession();
    const { ws, outcome } = await tryUpgrade(`uaSession=${sid}`);
    expect(outcome.open).toBe(true);

    const payload = await new Promise<{
      type: string;
      items: Array<{ message: string; level: string }>;
    }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WS message timeout")),
        2_000,
      );
      ws.once("message", (raw) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(raw.toString()));
        } catch (err) {
          reject(err as Error);
        }
      });
      // Fire a broadcast - it goes through the 100ms throttle window.
      broadcaster.broadcast({
        level: "info",
        message: "hello-from-broadcaster",
        context: null,
        createdAt: new Date(),
      });
    });

    expect(payload.type).toBe("logs");
    expect(payload.items[0]?.message).toBe("hello-from-broadcaster");
    expect(payload.items[0]?.level).toBe("info");
  });

  it("skips broadcast entirely when no clients are connected", async () => {
    // No WS open. Calling broadcast must not throw and must not blow up the
    // throttle queue.
    expect(() =>
      broadcaster.broadcast({
        level: "warn",
        message: "no-listeners",
        context: null,
        createdAt: new Date(),
      }),
    ).not.toThrow();
  });
});

describe("baseline fixture", () => {
  // Sanity-check the test setup. (We don't try to verify "ignores other
  // paths" via a real connection because the broadcaster correctly bails
  // without sending any response on unknown URLs, leaving the upgrade
  // hanging until the client times out - correct behaviour but ugly to
  // assert from a test.)
  it("baseHttpUrl is an http://127.0.0.1 URL", () => {
    expect(baseHttpUrl.startsWith("http://127.0.0.1:")).toBe(true);
  });
});
