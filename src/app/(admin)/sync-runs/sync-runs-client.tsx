"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { useDebouncedValue } from "@/app/_lib/use-debounced-value";
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
import type { SyncRun } from "@/app/(admin)/_lib/sync-types";

export function SyncRunsClient() {
  const t = useTranslations("syncRuns");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const debouncedSearch = useDebouncedValue(search.trim());
  // Default matches the server's default (startedAt desc) — see
  // SYNC_RUNS_SORT in src/server/routes/admin/sync.ts.
  const [sort, setSort] = useState<{ key: string; order: "asc" | "desc" }>({
    key: "startedAt",
    order: "desc",
  });

  const handleSortChange = (key: string) => {
    setSort((prev) =>
      prev.key === key
        ? { key, order: prev.order === "asc" ? "desc" : "asc" }
        : { key, order: "asc" },
    );
    setPage(1);
  };

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

  return (
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
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("filterPlaceholder")}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
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
      onSortChange={handleSortChange}
      rows={items.map((r) => {
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
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      }
    />
  );
}
