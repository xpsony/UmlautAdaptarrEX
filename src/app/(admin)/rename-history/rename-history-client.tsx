"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CornerDownRight, Download, ListChecks, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";
import { useListUrlState } from "@/app/(admin)/_lib/use-list-url-state";
import { diffTitleTokens, type TitleDiffSegment } from "@/lib/title-diff";
import { groupConsecutiveRenames } from "@/lib/rename-grouping";

interface Row {
  id: string;
  originalTitle: string;
  rewrittenTitle: string;
  mediaType: string;
  createdAt: string;
}

/**
 * One line of the stacked title cell. Renders the `same` segments muted and
 * the segments of the given kind highlighted; the other diff kind is omitted
 * (the original line never shows `added` text and vice versa).
 */
function TitleLine({
  segments,
  highlight,
  srLabel,
}: {
  segments: TitleDiffSegment[];
  highlight: "removed" | "added";
  srLabel: string;
}) {
  const highlightClass =
    highlight === "removed"
      ? "rounded-sm bg-red-500/10 px-0.5 text-red-600 line-through decoration-1 dark:text-red-400"
      : "rounded-sm bg-emerald-500/15 px-0.5 font-semibold text-emerald-700 dark:text-emerald-400";
  return (
    <>
      <span className="sr-only">{srLabel}: </span>
      {segments
        .filter((s) => s.kind === "same" || s.kind === highlight)
        .map((s, i) =>
          s.kind === highlight ? (
            <mark key={i} className={highlightClass}>
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
    </>
  );
}

export function RenameHistoryClient() {
  const t = useTranslations("history.rename");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();

  // Sortable columns exposed by the route - see RENAME_HISTORY_SORT in
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

  const items = useMemo(() => data.data?.items ?? [], [data.data?.items]);
  const total = data.data?.total ?? 0;
  // Presentation-only: collapse consecutive identical rewrites within the
  // loaded page. Pagination/total keep counting raw rows.
  const groups = useMemo(() => groupConsecutiveRenames(items), [items]);

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
    return `/api/admin/rename-history?${params}`;
  }, [debouncedSearch, sort.key, sort.order]);

  // ×N range formatting: time-only while the run stays within one calendar
  // day (the common case), full date+time otherwise.
  const formatRangeEnd = (iso: string, sameDay: boolean): string =>
    sameDay
      ? new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

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
        { label: t("mediaType"), sortKey: "mediaType" },
        t("titleColumn"),
      ]}
      sort={sort}
      onSortChange={url.toggleSort}
      rows={groups.map((g) => {
        const segments = diffTitleTokens(g.item.originalTitle, g.item.rewrittenTitle);
        const sameDay = new Date(g.firstAt).toDateString() === new Date(g.lastAt).toDateString();
        return (
          <TableRow key={g.item.id}>
            <TableCell className="align-top whitespace-nowrap text-muted-foreground">
              <div>{new Date(g.item.createdAt).toLocaleString(locale)}</div>
              {g.count > 1 ? (
                <div className="mt-0.5 text-xs">
                  {t("groupCount", {
                    count: g.count,
                    from: formatRangeEnd(g.firstAt, sameDay),
                    to: formatRangeEnd(g.lastAt, sameDay),
                  })}
                </div>
              ) : null}
            </TableCell>
            <TableCell className="align-top">
              <Badge variant="outline" className="capitalize">
                {g.item.mediaType}
              </Badge>
            </TableCell>
            <TableCell className="w-full align-top font-mono text-xs">
              <div className="break-all text-muted-foreground">
                <TitleLine segments={segments} highlight="removed" srLabel={t("originalTitle")} />
              </div>
              <div className="mt-0.5 flex items-start gap-1">
                <CornerDownRight
                  className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="break-all text-muted-foreground">
                  <TitleLine segments={segments} highlight="added" srLabel={t("rewrittenTitle")} />
                </span>
              </div>
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
  );
}
