"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, ListChecks, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";
import { useListUrlState } from "@/app/(admin)/_lib/use-list-url-state";

interface Row {
  id: string;
  originalTitle: string;
  rewrittenTitle: string;
  mediaType: string;
  createdAt: string;
}

export function RenameHistoryClient() {
  const t = useTranslations("history.rename");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();

  // Sortable columns exposed by the route — see RENAME_HISTORY_SORT in
  // src/server/routes/admin/history.ts. Default matches the server's
  // default (createdAt desc).
  const url = useListUrlState({
    defaultSort: { key: "createdAt", order: "desc" },
    validSortKeys: ["createdAt", "mediaType"],
  });
  const { page, pageSize, sort, searchInput, debouncedSearch } = url;

  const data = useQuery<{ items: Row[]; total: number }>({
    queryKey: ["rename-history", page, pageSize, debouncedSearch, sort.key, sort.order],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
        sort: sort.key,
        order: sort.order,
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch(`/api/admin/rename-history?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  // Same filters/sort as the JSON query above, plus `format=csv`. `take`/
  // `skip` are omitted — the CSV route ignores them in favor of its own
  // fixed row cap, so there's nothing meaningful to pass.
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({
      format: "csv",
      sort: sort.key,
      order: sort.order,
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/api/admin/rename-history?${params}`;
  }, [debouncedSearch, sort.key, sort.order]);

  return (
    <HistoryPage
      title={t("title")}
      subtitle={t("subtitle")}
      listTitle={t("listTitle", { count: total })}
      listSubtitle={t("listSubtitle")}
      emptyTitle={t("emptyTitle")}
      emptyHint={t("emptyHint")}
      emptyIcon={<ListChecks className="h-5 w-5" />}
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
            // plain new-tab navigation to the CSV URL is enough — no need to
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
        { label: t("mediaType"), sortKey: "mediaType" },
        t("originalTitle"),
        t("rewrittenTitle"),
      ]}
      sort={sort}
      onSortChange={url.toggleSort}
      rows={items.map((r) => (
        <TableRow key={r.id}>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {new Date(r.createdAt).toLocaleString(locale)}
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="capitalize">
              {r.mediaType}
            </Badge>
          </TableCell>
          <TableCell className="font-mono text-xs">{r.originalTitle}</TableCell>
          <TableCell className="font-mono text-xs">
            <span className="inline-flex items-center gap-2 text-foreground">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              {r.rewrittenTitle}
            </span>
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
  );
}
