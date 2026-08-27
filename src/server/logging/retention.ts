import { prisma } from "@/lib/db";
import type { AppLogger } from "./logger";
import { getAppState } from "@/server/state";

const FIRST_TICK_MS = 60_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
// Safety net for a hung deleteMany (locked SQLite WAL, runaway transaction).
// Without it, `this.running=true` would never reset and every future tick
// would silently skip with "already running". A 30s deadline is more than
// generous for purging old log rows; a real hang means something else is
// holding the DB lock.
const PURGE_TIMEOUT_MS = 30_000;

interface LogRetentionOptions {
  logger: AppLogger;
}

// Retention days are read live from settings on each tick so UI changes apply
// without a restart. One tick purges three tables: LogEntry (logRetentionDays)
// plus RequestHistory and RenameHistory (shared historyRetentionDays).
export class LogRetentionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly opts: LogRetentionOptions) {}

  start(): void {
    this.timer = setTimeout(() => {
      void this.tick();
    }, FIRST_TICK_MS);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runNow(): Promise<number> {
    return this.purge();
  }

  private async tick(): Promise<void> {
    await this.purge();
    this.timer = setTimeout(() => {
      void this.tick();
    }, INTERVAL_MS);
  }

  // Race a delete against a hard timeout so a stuck DB lock can't
  // permanently disable cleanup.
  private withTimeout(p: Promise<{ count: number }>, label: string): Promise<{ count: number }> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} retention purge timed out after ${PURGE_TIMEOUT_MS}ms`)),
          PURGE_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
  }

  private async purge(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const settings = getAppState().settings;
      const dayMs = 24 * 60 * 60 * 1000;
      const logCutoff = new Date(Date.now() - settings.logRetentionDays * dayMs);
      const historyCutoff = new Date(Date.now() - settings.historyRetentionDays * dayMs);

      const logResult = await this.withTimeout(
        prisma.logEntry.deleteMany({ where: { createdAt: { lt: logCutoff } } }),
        "log",
      );
      if (logResult.count > 0) {
        this.opts.logger.info(
          { deleted: logResult.count, retentionDays: settings.logRetentionDays },
          "log retention cleanup",
        );
      }

      const requestResult = await this.withTimeout(
        prisma.requestHistory.deleteMany({ where: { createdAt: { lt: historyCutoff } } }),
        "request-history",
      );
      const renameResult = await this.withTimeout(
        prisma.renameHistory.deleteMany({ where: { createdAt: { lt: historyCutoff } } }),
        "rename-history",
      );
      if (requestResult.count + renameResult.count > 0) {
        this.opts.logger.info(
          {
            deletedRequests: requestResult.count,
            deletedRenames: renameResult.count,
            retentionDays: settings.historyRetentionDays,
          },
          "history retention cleanup",
        );
      }

      // Let SQLite refresh its query-planner statistics after a bulk delete.
      // Cheap and non-critical: a failure - or a hang, raced against the same
      // PURGE_TIMEOUT_MS deadline as the deletes above, since an un-timed-out
      // PRAGMA would wedge `this.running` exactly like a hung deleteMany
      // would - must not fail the cleanup run that already deleted rows
      // successfully, so it's logged at debug and swallowed rather than
      // propagated to the outer catch.
      try {
        await this.withTimeout(
          prisma.$queryRawUnsafe("PRAGMA optimize;").then(() => ({ count: 0 })),
          "pragma-optimize",
        );
      } catch (err) {
        this.opts.logger.debug({ err }, "PRAGMA optimize failed after retention cleanup");
      }

      return logResult.count + requestResult.count + renameResult.count;
    } catch (err) {
      this.opts.logger.error({ err }, "log retention cleanup failed");
      return 0;
    } finally {
      this.running = false;
    }
  }
}
