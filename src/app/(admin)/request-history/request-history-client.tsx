"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, History, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";
import { httpStatusVariant } from "@/app/(admin)/_lib/status-variant";
import { useListUrlState } from "@/app/(admin)/_lib/use-list-url-state";
import { RequestDetailSheet } from "./_components/request-detail-sheet";
import type { RequestHistoryRow as Row } from "./_lib/request-history-types";

export function RequestHistoryClient() {
  const t = useTranslations("history.request");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();
  const [detail, setDetail] = useState<Row | null>(null);

  // Sortable columns exposed by the route - see REQUEST_HISTORY_SORT in
  // src/server/routes/admin/history.ts. Default matches the server's
  // default (createdAt desc).
  const url = useListUrlState({
    defaultSort: { key: "createdAt", order: "desc" },
    validSortKeys: ["createdAt", "status", "durationMs", "domain", "type"],
  });
  const { page, pageSize, sort, searchInput, debouncedSearch } = url;

  const data = useQuery<{ items: Row[]; total: number }>({
    queryKey: ["request-history", page, pageSize, debouncedSearch, sort.key, sort.order],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
        sort: sort.key,
        order: sort.order,
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch(`/api/admin/request-history?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  // Same filters/sort as the JSON query above, plus `format=csv`. `take`/
  // `skip` are omitted - the CSV route ignores them in favor of its own
  // fixed row cap, so there's nothing meaningful to pass.
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({
      format: "csv",
      sort: sort.key,
      order: sort.order,
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/api/admin/request-history?${params}`;
  }, [debouncedSearch, sort.key, sort.order]);

  return (
    <>
      <HistoryPage
        title={t("title")}
        subtitle={t("subtitle")}
        listTitle={t("listTitle", { count: total })}
        listSubtitle={t("listSubtitle")}
        emptyTitle={t("emptyTitle")}
        emptyHint={t("emptyHint")}
        emptyIcon={<History className="h-5 w-5" />}
        isLoading={data.isLoading}
        isError={data.isLoadingError}
        errorLabel={tCommon("error")}
        retryLabel={tBoundaries("retry")}
        onRetry={() => void data.refetch()}
        retryPending={data.isFetching}
        isEmpty={items.length === 0}
        filterSlot={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => url.setSearchInput(e.target.value)}
                placeholder={t("filterPlaceholder")}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0}
              // Cookie-based auth + the Next proxy streaming `/api/*` means a
              // plain new-tab navigation to the CSV URL is enough - no need to
              // fetch+blob the response client-side.
              onClick={() => window.open(exportUrl, "_blank")}
            >
              <Download className="h-4 w-4" />
              {tCommon("export")}
            </Button>
          </div>
        }
        columns={[
          { label: t("createdAt"), sortKey: "createdAt" },
          { label: t("type"), sortKey: "type" },
          { label: t("domain"), sortKey: "domain" },
          t("query"),
          t("externalId"),
          { label: t("status"), sortKey: "status" },
          { label: t("duration"), sortKey: "durationMs" },
          t("cacheHit"),
        ]}
        sort={sort}
        onSortChange={url.toggleSort}
        rows={items.map((r) => (
          <TableRow
            key={r.id}
            className="cursor-pointer focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            tabIndex={0}
            role="button"
            aria-label={`${r.type} ${r.domain}`}
            onClick={() => setDetail(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDetail(r);
              }
            }}
          >
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {new Date(r.createdAt).toLocaleString(locale)}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="capitalize">
                {r.type}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">{r.domain}</TableCell>
            <TableCell className="max-w-xs truncate font-mono text-xs">
              {r.query ?? <span className="text-muted-foreground">-</span>}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {r.externalId ?? <span className="text-muted-foreground">-</span>}
            </TableCell>
            <TableCell>
              <Badge variant={httpStatusVariant(r.status)} className="tabular-nums">
                {r.status}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums">{r.durationMs}ms</TableCell>
            <TableCell>
              {r.cacheHit ? (
                <Badge variant="info">{t("cacheHitYes")}</Badge>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
          </TableRow>
        ))}
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
      <RequestDetailSheet open={detail !== null} item={detail} onClose={() => setDetail(null)} />
    </>
  );
}
