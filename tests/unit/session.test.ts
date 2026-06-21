import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { session: mockSession },
}));

import {
  createSession,
  getSession,
  revokeSession,
  SESSION_TTL_MS,
} from "@/lib/auth/session";

beforeEach(() => {
  mockSession.create.mockReset();
  mockSession.findUnique.mockReset();
  mockSession.update.mockReset();
  mockSession.delete.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SESSION_TTL_MS", () => {
  // vitest sets NODE_ENV=test by default; we whitelist only "development"
  // for the long TTL so anything else (including production AND unset)
  // gets the strict 14-day window.
  it("is 14 days during tests since NODE_ENV is not 'development'", () => {
    expect(SESSION_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("collapses to 14 days when NODE_ENV is production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    try {
      const mod = await import("@/lib/auth/session");
      expect(mod.SESSION_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stays at 14 days when NODE_ENV is unset (defense-in-depth)", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "");
    try {
      const mod = await import("@/lib/auth/session");
      expect(mod.SESSION_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("expands to 365 days only when NODE_ENV is explicitly 'development'", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    try {
      const mod = await import("@/lib/auth/session");
      expect(mod.SESSION_TTL_MS).toBe(365 * 24 * 60 * 60 * 1000);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("createSession", () => {
  it("persists a row with a fresh nanoid id and a TTL-based expiry", async () => {
    mockSession.create.mockResolvedValueOnce({});

    const before = Date.now();
    const result = await createSession("user-123");
    const after = Date.now();

    expect(typeof result.id).toBe("string");
    // nanoid(48) yields 48 url-safe characters.
    expect(result.id.length).toBe(48);

    expect(mockSession.create).toHaveBeenCalledOnce();
    const args = mockSession.create.mock.calls[0]?.[0] as {
      data: { id: string; userId: string; expiresAt: Date };
    };
    expect(args.data.id).toBe(result.id);
    expect(args.data.userId).toBe("user-123");
    expect(args.data.expiresAt).toBeInstanceOf(Date);

    const expiresMs = result.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 100);
    expect(expiresMs).toBeLessThanOrEqual(after + SESSION_TTL_MS + 100);
  });
});

describe("getSession", () => {
  it("returns null when the session does not exist", async () => {
    mockSession.findUnique.mockResolvedValueOnce(null);

    expect(await getSession("missing")).toBeNull();
    expect(mockSession.update).not.toHaveBeenCalled();
    expect(mockSession.delete).not.toHaveBeenCalled();
  });

  it("returns null and deletes the row when the session has expired", async () => {
    mockSession.findUnique.mockResolvedValueOnce({
      id: "old",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1000),
    });
    mockSession.delete.mockResolvedValueOnce({});

    expect(await getSession("old")).toBeNull();
    expect(mockSession.delete).toHaveBeenCalledWith({ where: { id: "old" } });
    expect(mockSession.update).not.toHaveBeenCalled();
  });

  it("swallows delete failures while still returning null on expiry", async () => {
    mockSession.findUnique.mockResolvedValueOnce({
      id: "old",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1000),
    });
    mockSession.delete.mockRejectedValueOnce(new Error("connection lost"));

    expect(await getSession("old")).toBeNull();
  });

  it("updates lastUsed and returns id and userId for a valid session", async () => {
    mockSession.findUnique.mockResolvedValueOnce({
      id: "good",
      userId: "user-2",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockSession.update.mockResolvedValueOnce({});

    const result = await getSession("good");
    expect(result).toEqual({ id: "good", userId: "user-2" });

    expect(mockSession.update).toHaveBeenCalledOnce();
    const updateArgs = mockSession.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { lastUsed: Date };
    };
    expect(updateArgs.where).toEqual({ id: "good" });
    expect(updateArgs.data.lastUsed).toBeInstanceOf(Date);
  });

  it("skips the lastUsed write when it was refreshed recently (throttle)", async () => {
    mockSession.findUnique.mockResolvedValueOnce({
      id: "good",
      userId: "user-2",
      expiresAt: new Date(Date.now() + 60_000),
      // Refreshed a few seconds ago — well inside the throttle window.
      lastUsed: new Date(Date.now() - 5_000),
    });

    const result = await getSession("good");
    expect(result).toEqual({ id: "good", userId: "user-2" });
    expect(mockSession.update).not.toHaveBeenCalled();
  });
});

describe("revokeSession", () => {
  it("deletes the session row by id", async () => {
    mockSession.delete.mockResolvedValueOnce({});

    await revokeSession("some-id");

    expect(mockSession.delete).toHaveBeenCalledWith({
      where: { id: "some-id" },
    });
  });

  it("swallows errors when the session is already gone", async () => {
    mockSession.delete.mockRejectedValueOnce(new Error("P2025: not found"));

    await expect(revokeSession("missing")).resolves.toBeUndefined();
  });
});
