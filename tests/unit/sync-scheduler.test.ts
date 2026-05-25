import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockArr, mockSyncRun } = vi.hoisted(() => ({
  mockArr: { findMany: vi.fn() },
  mockSyncRun: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: { arrInstance: mockArr, syncRun: mockSyncRun },
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    provider: { name: "stub" } as object | null,
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

const { mockRunSync } = vi.hoisted(() => ({
  mockRunSync: vi.fn(),
}));

vi.mock("@/server/sync/run", () => ({
  runSync: mockRunSync,
}));

import { SyncScheduler } from "@/server/sync/scheduler";

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

beforeEach(() => {
  mockArr.findMany.mockReset();
  mockSyncRun.create.mockReset();
  mockRunSync.mockReset();
  mockState.provider = { name: "stub" };
});

afterEach(() => {
  mockArr.findMany.mockReset();
  mockSyncRun.create.mockReset();
  mockRunSync.mockReset();
});

describe("SyncScheduler.runNow", () => {
  it("returns no_provider when a Sonarr/Radarr instance is enabled but no title provider is configured", async () => {
    mockState.provider = null;
    mockArr.findMany.mockResolvedValueOnce([{ id: "inst-sonarr", enabled: true, type: "sonarr" }]);
    const sched = new SyncScheduler({ logger: makeLogger() as never });
    expect(await sched.runNow()).toEqual({ status: "no_provider" });
  });

  it("proceeds without a provider when only Lidarr/Readarr instances are enabled", async () => {
    mockState.provider = null;
    mockArr.findMany.mockResolvedValueOnce([
      { id: "inst-lidarr", enabled: true, type: "lidarr" },
      { id: "inst-readarr", enabled: true, type: "readarr" },
    ]);
    mockSyncRun.create
      .mockResolvedValueOnce({ id: "run-l" })
      .mockResolvedValueOnce({ id: "run-r" });
    mockRunSync.mockResolvedValue({ totalItems: 0, perInstance: [] });

    const sched = new SyncScheduler({ logger: makeLogger() as never });
    const out = await sched.runNow();
    expect(out).toEqual({
      status: "started",
      runIds: ["run-l", "run-r"],
      instanceCount: 2,
    });
  });

  it("returns no_instances when no enabled instances exist", async () => {
    mockArr.findMany.mockResolvedValueOnce([]);
    const sched = new SyncScheduler({ logger: makeLogger() as never });
    expect(await sched.runNow()).toEqual({ status: "no_instances" });
  });

  it("creates one SyncRun per instance and reports started", async () => {
    mockArr.findMany.mockResolvedValueOnce([
      { id: "inst-1", enabled: true },
      { id: "inst-2", enabled: true },
    ]);
    mockSyncRun.create
      .mockResolvedValueOnce({ id: "run-1" })
      .mockResolvedValueOnce({ id: "run-2" });
    // Fire-and-forget background work; let it settle quickly.
    mockRunSync.mockResolvedValue({
      totalItems: 0,
      perInstance: [],
    });

    const sched = new SyncScheduler({ logger: makeLogger() as never });
    const out = await sched.runNow();
    expect(out).toEqual({
      status: "started",
      runIds: ["run-1", "run-2"],
      instanceCount: 2,
    });
    expect(mockSyncRun.create).toHaveBeenCalledTimes(2);
  });

  it("filters by instanceId when provided", async () => {
    mockArr.findMany.mockResolvedValueOnce([{ id: "inst-only", enabled: true }]);
    mockSyncRun.create.mockResolvedValueOnce({ id: "run-1" });
    mockRunSync.mockResolvedValue({ totalItems: 0, perInstance: [] });

    const sched = new SyncScheduler({ logger: makeLogger() as never });
    await sched.runNow("inst-only");

    const args = mockArr.findMany.mock.calls[0]?.[0] as {
      where: { id?: string; enabled: boolean };
    };
    expect(args.where).toEqual({ id: "inst-only", enabled: true });
  });

  it("returns already_running when a previous run is still in flight", async () => {
    mockArr.findMany.mockResolvedValueOnce([{ id: "i1", enabled: true }]);
    mockSyncRun.create.mockResolvedValueOnce({ id: "r1" });

    let resolveSync!: () => void;
    mockRunSync.mockReturnValueOnce(
      new Promise<{ totalItems: number; perInstance: never[] }>((resolve) => {
        resolveSync = () => resolve({ totalItems: 0, perInstance: [] });
      }),
    );

    const sched = new SyncScheduler({ logger: makeLogger() as never });
    const first = await sched.runNow();
    expect(first.status).toBe("started");
    const second = await sched.runNow();
    expect(second.status).toBe("already_running");
    resolveSync();
  });
});

describe("SyncScheduler lifecycle", () => {
  it("stop() before start() is a no-op", () => {
    const sched = new SyncScheduler({ logger: makeLogger() as never });
    expect(() => sched.stop()).not.toThrow();
  });

  it("start() and stop() do not throw", () => {
    const sched = new SyncScheduler({ logger: makeLogger() as never });
    sched.start();
    expect(() => sched.stop()).not.toThrow();
  });
});
