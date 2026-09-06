import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLog, mockReqHistory, mockRenameHistory, mockSyncRun, mockState, mockQueryRawUnsafe } =
  vi.hoisted(() => ({
    mockLog: {
      deleteMany: vi.fn(),
    },
    mockReqHistory: {
      deleteMany: vi.fn(),
    },
    mockRenameHistory: {
      deleteMany: vi.fn(),
    },
    mockSyncRun: {
      deleteMany: vi.fn(),
    },
    mockState: {
      settings: { logRetentionDays: 14, historyRetentionDays: 30 },
    },
    mockQueryRawUnsafe: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    logEntry: mockLog,
    requestHistory: mockReqHistory,
    renameHistory: mockRenameHistory,
    syncRun: mockSyncRun,
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

import { LogRetentionScheduler } from "@/server/logging/retention";

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
  for (const m of [mockLog, mockReqHistory, mockRenameHistory, mockSyncRun]) {
    m.deleteMany.mockReset();
    m.deleteMany.mockResolvedValue({ count: 0 });
  }
  mockQueryRawUnsafe.mockReset();
  mockQueryRawUnsafe.mockResolvedValue(undefined);
  mockState.settings.logRetentionDays = 14;
  mockState.settings.historyRetentionDays = 30;
});

afterEach(() => {
  for (const m of [mockLog, mockReqHistory, mockRenameHistory, mockSyncRun]) {
    m.deleteMany.mockReset();
  }
  mockQueryRawUnsafe.mockReset();
});

describe("LogRetentionScheduler", () => {
  it("deletes log rows older than the retention window from settings", async () => {
    mockState.settings.logRetentionDays = 7;
    mockLog.deleteMany.mockResolvedValueOnce({ count: 3 });

    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });

    const before = Date.now();
    await sched.runNow();
    const after = Date.now();

    expect(mockLog.deleteMany).toHaveBeenCalledOnce();
    const cutoff = (
      mockLog.deleteMany.mock.calls[0]?.[0] as {
        where: { createdAt: { lt: Date } };
      }
    ).where.createdAt.lt;
    expect(cutoff).toBeInstanceOf(Date);

    const expectedFloor = before - 7 * 24 * 60 * 60 * 1000;
    const expectedCeil = after - 7 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedFloor - 100);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedCeil + 100);

    expect(logger.info).toHaveBeenCalledOnce();
  });

  it("does not log when nothing was deleted", async () => {
    mockLog.deleteMany.mockResolvedValueOnce({ count: 0 });
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });
    await sched.runNow();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs an error and returns 0 on failure", async () => {
    mockLog.deleteMany.mockRejectedValueOnce(new Error("io"));
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });
    expect(await sched.runNow()).toBe(0);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("stop() is safe before start()", () => {
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });
    expect(() => sched.stop()).not.toThrow();
  });

  it("purges request and rename history older than historyRetentionDays", async () => {
    mockState.settings.historyRetentionDays = 30;
    mockReqHistory.deleteMany.mockResolvedValueOnce({ count: 5 });
    mockRenameHistory.deleteMany.mockResolvedValueOnce({ count: 2 });

    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });

    const before = Date.now();
    const deleted = await sched.runNow();
    const after = Date.now();

    expect(deleted).toBe(7); // 0 logs + 5 requests + 2 renames

    for (const mock of [mockReqHistory, mockRenameHistory]) {
      expect(mock.deleteMany).toHaveBeenCalledOnce();
      const cutoff = (
        mock.deleteMany.mock.calls[0]?.[0] as {
          where: { createdAt: { lt: Date } };
        }
      ).where.createdAt.lt;
      const expectedFloor = before - 30 * 24 * 60 * 60 * 1000;
      const expectedCeil = after - 30 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedFloor - 100);
      expect(cutoff.getTime()).toBeLessThanOrEqual(expectedCeil + 100);
    }

    // One "history retention cleanup" info line for the two history tables.
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0]?.[1]).toBe("history retention cleanup");
  });

  it("uses independent cutoffs for logs and history", async () => {
    mockState.settings.logRetentionDays = 3;
    mockState.settings.historyRetentionDays = 60;
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });
    await sched.runNow();

    const logCutoff = (
      mockLog.deleteMany.mock.calls[0]?.[0] as {
        where: { createdAt: { lt: Date } };
      }
    ).where.createdAt.lt.getTime();
    const histCutoff = (
      mockReqHistory.deleteMany.mock.calls[0]?.[0] as {
        where: { createdAt: { lt: Date } };
      }
    ).where.createdAt.lt.getTime();
    // The 60d cutoff lies further in the past than the 3d cutoff.
    expect(histCutoff).toBeLessThan(logCutoff);
  });

  it("does not log history cleanup when nothing was deleted", async () => {
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });
    await sched.runNow();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs an error and returns 0 when a history delete fails", async () => {
    mockReqHistory.deleteMany.mockRejectedValueOnce(new Error("io"));
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });
    expect(await sched.runNow()).toBe(0);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("runs PRAGMA optimize after a successful delete batch", async () => {
    mockLog.deleteMany.mockResolvedValueOnce({ count: 3 });
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });
    await sched.runNow();

    expect(mockQueryRawUnsafe).toHaveBeenCalledOnce();
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith("PRAGMA optimize;");
  });

  it("does not fail the cleanup run when PRAGMA optimize rejects", async () => {
    mockLog.deleteMany.mockResolvedValueOnce({ count: 3 });
    mockQueryRawUnsafe.mockRejectedValueOnce(new Error("pragma boom"));
    const logger = makeLogger();
    const sched = new LogRetentionScheduler({ logger: logger as never });

    const deleted = await sched.runNow();

    expect(deleted).toBe(3);
    expect(logger.debug).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("SyncRun retention", () => {
  it("purges SyncRun rows older than historyRetentionDays", async () => {
    const sched = new LogRetentionScheduler({ logger: makeLogger() as never });
    await sched.runNow();

    expect(mockSyncRun.deleteMany).toHaveBeenCalledWith({
      where: { startedAt: { lt: expect.any(Date) } },
    });
  });

  it("counts purged SyncRun rows in the returned total", async () => {
    mockSyncRun.deleteMany.mockResolvedValueOnce({ count: 7 });
    const sched = new LogRetentionScheduler({ logger: makeLogger() as never });

    expect(await sched.runNow()).toBe(7);
  });
});
