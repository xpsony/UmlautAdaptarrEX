"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Input } from "@/components/ui/input";
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
import { TablePagination } from "@/components/ui/table-pagination";
import { syncStatusVariant } from "@/app/(admin)/_lib/status-variant";
import { useListUrlState } from "@/app/(admin)/_lib/use-list-url-state";
import type { SyncRun } from "@/app/(admin)/_lib/sync-types";
import { RunDetailSheet } from "./_components/run-detail-sheet";

// Sortable columns exposed by the route — see SYNC_RUNS_SORT in
// src/server/routes/admin/sync.ts. Default matches the server's default
// (startedAt desc).
const SORT_KEYS = ["startedAt", "status", "itemsCount"] as const;

// Status values the filter Select offers — a bogus deep-link value falls
// back to "all" instead of leaving the Select trigger blank.
const STATUS_VALUES = ["running", "success", "error", "cancelled"] as const;

export function SyncRunsClient() {
  const t = useTranslations("syncRuns");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();

  const url = useListUrlState({
    defaultSort: { key: "startedAt", order: "desc" },
    validSortKeys: SORT_KEYS,
  });
  const { page, pageSize, sort, searchInput, debouncedSearch } = url;
  const statusFilter = url.getParam("status", "all", STATUS_VALUES);
  const [detail, setDetail] = useState<SyncRun | null>(null);

  const runs = useQuery<{ items: SyncRun[]; total: number }>({
    queryKey: [
      "sync-runs",
      "list",
      page,
      pageSize,
      debouncedSearch,
      statusFilter,
      sort.key,
      sort.order,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
        sort: sort.key,
        order: sort.order,
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);
      return apiFetch(`/api/admin/sync-runs?${params}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });

  const items = runs.data?.items ?? [];
  const total = runs.data?.total ?? 0;
  // Re-derive the open run from the latest page data so the 5s background
  // refetch (e.g. a running sync finishing) updates the open sheet instead of
  // showing the stale snapshot captured at click time.
  const detailRun = detail ? (items.find((i) => i.id === detail.id) ?? detail) : null;

  return (
    <>
      <HistoryPage
        title={t("title")}
        subtitle={t("subtitle")}
        listTitle={t("listTitle", { count: total })}
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
        isEmpty={items.length === 0}
        filterSlot={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => url.setSearchInput(e.target.value)}
                placeholder={t("filterPlaceholder")}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => url.setFilters({ status: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filterAll")}</SelectItem>
                <SelectItem value="running">{t("filterRunning")}</SelectItem>
                <SelectItem value="success">{t("filterOk")}</SelectItem>
                <SelectItem value="error">{t("filterError")}</SelectItem>
                <SelectItem value="cancelled">{t("filterCancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        columns={[
          t("colInstance"),
          { label: t("colStatus"), sortKey: "status" },
          { label: t("colItems"), sortKey: "itemsCount" },
          t("colPcjones"),
          t("colTvdb"),
          t("colTmdb"),
          { label: t("colStarted"), sortKey: "startedAt" },
          t("colDuration"),
          t("colError"),
        ]}
        sort={sort}
        onSortChange={url.toggleSort}
        rows={items.map((r) => {
          const duration =
            r.finishedAt && r.startedAt
              ? Math.max(0, new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime())
              : null;
          return (
            <TableRow
              key={r.id}
              className="cursor-pointer focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              tabIndex={0}
              role="button"
              aria-label={r.arrInstance?.name ?? t("detailUnknownInstance")}
              onClick={() => setDetail(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetail(r);
                }
              }}
            >
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
                <Badge variant={syncStatusVariant(r.status)} className="capitalize">
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{r.itemsCount}</TableCell>
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
        footerSlot={
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={url.setPage}
            onPageSizeChange={url.setPageSize}
          />
        }
      />
      <RunDetailSheet open={detail !== null} run={detailRun} onClose={() => setDetail(null)} />
    </>
  );
}
