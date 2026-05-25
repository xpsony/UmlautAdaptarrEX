import { prisma } from "@/lib/db";
import type { AppLogger } from "@/server/logging/logger";
import { getAppState } from "@/server/state";
import { type PreparedRun, runSync, type SyncResult } from "./run";

const SUCCESS_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FIRST_FAIL_INTERVAL_MS = 2 * 60 * 1000;
const REPEATED_FAIL_INTERVAL_MS = 60 * 60 * 1000;

// Wall-time watchdog: if the running flag stays true beyond this window,
// something in executePrepared has hung (a stuck HTTP request, deadlocked
// Prisma transaction, …). The watchdog resets the flag and logs so the
// next tick can run; the orphaned promise keeps going but its own writes
// are idempotent against the SyncRun row, so a late completion just
// updates the row to "succeeded"/"errored" with no follow-on damage.
const RUNNING_FLAG_WATCHDOG_MS = 6 * 60 * 60 * 1000;

interface SchedulerOptions {
  logger: AppLogger;
}

type RunNowOutcome =
  | { status: "started"; runIds: string[]; instanceCount: number }
  | { status: "no_provider" }
  | { status: "already_running" }
  | { status: "no_instances" };

export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private failures = 0;
  private running = false;

  constructor(private readonly opts: SchedulerOptions) {}

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.running) {
        this.opts.logger.error(
          { watchdogMs: RUNNING_FLAG_WATCHDOG_MS },
          "sync watchdog: running flag stuck for >6h; resetting so the next tick can proceed",
        );
        this.running = false;
      }
    }, RUNNING_FLAG_WATCHDOG_MS);
    // Don't keep the event loop alive solely for the watchdog.
    this.watchdog.unref?.();
  }

  private disarmWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  start(): void {
    this.timer = setTimeout(() => {
      void this.tick();
    }, 30_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.disarmWatchdog();
  }

  // Creates SyncRun rows synchronously (so the UI has poll targets immediately)
  // and kicks the actual sync without awaiting it. Returns the run IDs.
  async runNow(instanceId?: string): Promise<RunNowOutcome> {
    if (this.running) {
      this.opts.logger.warn("sync skipped: already running");
      return { status: "already_running" };
    }
    const state = getAppState();

    const where = instanceId ? { id: instanceId, enabled: true } : { enabled: true };
    const instances = await prisma.arrInstance.findMany({ where });
    if (instances.length === 0) {
      this.opts.logger.info("sync skipped: no enabled instances");
      return { status: "no_instances" };
    }

    const needsProvider = instances.some((i) => i.type === "sonarr" || i.type === "radarr");
    if (needsProvider && !state.provider) {
      this.opts.logger.warn("sync skipped: no title provider configured");
      return { status: "no_provider" };
    }

    const prepared = await Promise.all(
      instances.map(async (inst) => {
        const run = await prisma.syncRun.create({
          data: { arrInstanceId: inst.id, status: "running" },
        });
        return { runId: run.id, instance: inst } satisfies PreparedRun;
      }),
    );

    this.running = true;
    this.armWatchdog();
    void this.executePrepared(prepared)
      .catch((err) => this.opts.logger.error({ err }, "background sync crashed unexpectedly"))
      .finally(() => {
        this.running = false;
        this.disarmWatchdog();
      });

    return {
      status: "started",
      runIds: prepared.map((p) => p.runId),
      instanceCount: prepared.length,
    };
  }

  private async tick(): Promise<void> {
    await this.runScheduled();
    const next =
      this.failures === 0
        ? SUCCESS_INTERVAL_MS
        : this.failures === 1
          ? FIRST_FAIL_INTERVAL_MS
          : REPEATED_FAIL_INTERVAL_MS;
    this.timer = setTimeout(() => {
      void this.tick();
    }, next);
  }

  // Awaits completion (unlike `runNow`) so the next tick interval can be picked.
  private async runScheduled(): Promise<void> {
    if (this.running) {
      this.opts.logger.warn("scheduled sync skipped: already running");
      return;
    }
    const state = getAppState();
    const instances = await prisma.arrInstance.findMany({
      where: { enabled: true },
    });
    if (instances.length === 0) return;
    const needsProvider = instances.some((i) => i.type === "sonarr" || i.type === "radarr");
    if (needsProvider && !state.provider) {
      this.opts.logger.warn("scheduled sync skipped: no provider configured");
      return;
    }

    const prepared = await Promise.all(
      instances.map(async (inst) => {
        const run = await prisma.syncRun.create({
          data: { arrInstanceId: inst.id, status: "running" },
        });
        return { runId: run.id, instance: inst } satisfies PreparedRun;
      }),
    );

    this.running = true;
    this.armWatchdog();
    try {
      await this.executePrepared(prepared);
    } finally {
      this.running = false;
      this.disarmWatchdog();
    }
  }

  private async executePrepared(prepared: PreparedRun[]): Promise<SyncResult | null> {
    try {
      const result = await runSync({
        logger: this.opts.logger,
        preparedRuns: prepared,
      });
      const hasError = result.perInstance.some((p) => p.error);
      if (hasError) this.failures += 1;
      else this.failures = 0;
      this.opts.logger.info(
        {
          totalItems: result.totalItems,
          instances: result.perInstance.length,
          errors: result.perInstance.filter((p) => p.error).length,
        },
        "sync done",
      );
      return result;
    } catch (err) {
      this.failures += 1;
      this.opts.logger.error({ err }, "sync run failed");
      return null;
    }
  }
}
