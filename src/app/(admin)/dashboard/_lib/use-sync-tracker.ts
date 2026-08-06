"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/app/_lib/api-client";
import type { SyncRun } from "@/app/(admin)/_lib/sync-types";
import type { SyncStartResponse } from "./dashboard-types";

interface UseSyncTrackerOptions {
  onCompleted?: () => void;
}

// Encapsulates the "start a sync, then poll its run IDs and toast on
// completion" workflow. Keeps the dashboard page focused on rendering and
// makes the lifecycle testable in isolation.
export function useSyncTracker({ onCompleted }: UseSyncTrackerOptions = {}) {
  const t = useTranslations("dashboard");
  const [trackedRunIds, setTrackedRunIds] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  const tracked = useQuery<{ items: SyncRun[]; total: number }>({
    queryKey: ["sync-runs-tracked", trackedRunIds],
    queryFn: () => apiFetch(`/api/admin/sync-runs?ids=${trackedRunIds.join(",")}`),
    enabled: trackedRunIds.length > 0,
    refetchInterval: trackedRunIds.length > 0 ? 1500 : false,
  });

  const summary = useMemo(() => {
    const list = tracked.data?.items ?? [];
    const finished = list.filter((r) => r.status !== "running");
    const errors = list.filter((r) => r.status === "error");
    const running = list.filter((r) => r.status === "running");
    const total = trackedRunIds.length;
    const totalItems = list.reduce((sum, r) => sum + (r.itemsCount ?? 0), 0);
    return { list, finished, errors, running, total, totalItems };
  }, [tracked.data, trackedRunIds]);

  // The batch is finished once every run is loaded (server may not have
  // returned them all yet) AND none is still "running". The guard ref prevents
  // duplicate toasts and keeps the reset out of the effect body (otherwise
  // react-hooks/set-state-in-effect would fire).
  const notifiedBatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (trackedRunIds.length === 0) {
      notifiedBatchRef.current = null;
      return;
    }
    const list = tracked.data?.items;
    if (!list || list.length < trackedRunIds.length) return;
    const stillRunning = list.some((r) => r.status === "running");
    if (stillRunning) return;
    const batchKey = trackedRunIds.join(",");
    if (notifiedBatchRef.current === batchKey) return;
    notifiedBatchRef.current = batchKey;

    const errors = list.filter((r) => r.status === "error");
    const totalItems = list.reduce((sum, r) => sum + (r.itemsCount ?? 0), 0);
    if (errors.length > 0) {
      toast.error(t("syncDoneWithErrors", { items: totalItems, errors: errors.length }), {
        description: errors
          .map((e) => `${e.arrInstance?.name ?? "—"}: ${e.errorMessage ?? "unbekannt"}`)
          .slice(0, 3)
          .join("\n"),
      });
    } else {
      toast.success(t("syncDone", { items: totalItems, instances: list.length }));
    }
    onCompleted?.();
    queueMicrotask(() => setTrackedRunIds([]));
  }, [tracked.data, trackedRunIds, t, onCompleted]);

  async function start(): Promise<void> {
    setStarting(true);
    try {
      const res = await apiFetch<SyncStartResponse>("/api/admin/sync", {
        method: "POST",
        body: JSON.stringify({}),
      });
      // Keep the dialog open and track the run IDs; closing the dialog still
      // lets the sync continue in the background.
      setTrackedRunIds(res.runIds);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("syncFailed"));
      }
    } finally {
      setStarting(false);
    }
  }

  const tracking = trackedRunIds.length > 0;
  const progressPct =
    summary.total > 0 ? Math.round((summary.finished.length / summary.total) * 100) : 0;

  return {
    start,
    starting,
    tracking,
    summary,
    progressPct,
  };
}

export type SyncTracker = ReturnType<typeof useSyncTracker>;
