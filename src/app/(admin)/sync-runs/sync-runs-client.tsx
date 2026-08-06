"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrIcon, type ArrIconType } from "@/components/ui/arr-icon";
import { HistoryPage } from "@/components/ui/history-page";

interface SyncRun {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  itemsCount: number;
  pcjonesItemsCount: number;
  tmdbItemsCount: number;
  tvdbItemsCount: number;
  errorMessage?: string | null;
  arrInstance: { name: string; type: string } | null;
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "muted" {
  switch (status.toLowerCase()) {
    case "ok":
    case "success":
    case "completed":
      return "success";
    case "running":
    case "queued":
    case "pending":
      return "warning";
    case "failed":
    case "error":
      return "destructive";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "muted";
    default:
      return "muted";
  }
}

export function SyncRunsClient() {
  const t = useTranslations("syncRuns");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const runs = useQuery<SyncRun[]>({
    queryKey: ["sync-runs", "all"],
    queryFn: () => apiFetch<SyncRun[]>("/api/admin/sync-runs?take=200"),
    refetchInterval: 5000,
  });

  const filtered = useMemo(() => {
    const list = runs.data ?? [];
    if (statusFilter === "all") return list;
    return list.filter((r) => r.status.toLowerCase() === statusFilter);
  }, [runs.data, statusFilter]);

  return (
    <HistoryPage
      title={t("title")}
      subtitle={t("subtitle")}
      listTitle={t("listTitle", { count: runs.data?.length ?? 0 })}
      listSubtitle={t("listSubtitle")}
      emptyTitle={t("emptyTitle")}
      emptyHint={t("emptyHint")}
      emptyIcon={<Activity className="h-5 w-5" />}
      isLoading={runs.isLoading}
      isError={runs.isLoadingError}
      errorLabel={tCommon("error")}
      retryLabel={tBoundaries("retry")}
      onRetry={() => void runs.refetch()}
      retryPending={runs.isFetching}
      isEmpty={filtered.length === 0}
      filterSlot={
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAll")}</SelectItem>
            <SelectItem value="running">{t("filterRunning")}</SelectItem>
            <SelectItem value="ok">{t("filterOk")}</SelectItem>
            <SelectItem value="error">{t("filterError")}</SelectItem>
            <SelectItem value="cancelled">{t("filterCancelled")}</SelectItem>
          </SelectContent>
        </Select>
      }
      columns={[
        t("colInstance"),
        t("colStatus"),
        t("colPcjones"),
        t("colTvdb"),
        t("colTmdb"),
        t("colStarted"),
        t("colDuration"),
        t("colError"),
      ]}
      rows={filtered.map((r) => {
        const duration =
          r.finishedAt && r.startedAt
            ? Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime())
            : null;
        return (
          <TableRow key={r.id}>
            <TableCell>
              {r.arrInstance ? (
                <div className="flex items-center gap-2">
                  <ArrIcon type={r.arrInstance.type as ArrIconType} size={18} />
                  <span className="font-medium">{r.arrInstance.name}</span>
                  <Badge variant="outline" className="capitalize">
                    {r.arrInstance.type}
                  </Badge>
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(r.status)} className="capitalize">
                {r.status}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums">{r.pcjonesItemsCount}</TableCell>
            <TableCell className="tabular-nums">{r.tvdbItemsCount}</TableCell>
            <TableCell className="tabular-nums">{r.tmdbItemsCount}</TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {new Date(r.startedAt).toLocaleString(locale)}
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {duration === null ? "—" : `${(duration / 1000).toFixed(1)}s`}
            </TableCell>
            <TableCell className="max-w-xs truncate text-xs text-destructive">
              {r.errorMessage ?? <span className="text-muted-foreground">—</span>}
            </TableCell>
          </TableRow>
        );
      })}
    />
  );
}
