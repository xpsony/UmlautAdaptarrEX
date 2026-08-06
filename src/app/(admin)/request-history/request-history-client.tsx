"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { useDebouncedValue } from "@/app/_lib/use-debounced-value";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";

interface Row {
  id: string;
  type: string;
  domain: string;
  query: string | null;
  externalId: string | null;
  status: number;
  durationMs: number;
  cacheHit: boolean;
  createdAt: string;
}

function statusVariant(status: number): "success" | "warning" | "destructive" | "muted" {
  if (status >= 500) return "destructive";
  if (status >= 400) return "warning";
  if (status >= 200 && status < 300) return "success";
  return "muted";
}

export function RequestHistoryClient() {
  const t = useTranslations("history.request");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());

  const data = useQuery<{ items: Row[]; total: number }>({
    queryKey: ["request-history", page, pageSize, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch(`/api/admin/request-history?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  return (
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
        <div className="relative w-full sm:w-72">
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
      }
      columns={[
        t("createdAt"),
        t("type"),
        t("domain"),
        t("query"),
        t("externalId"),
        t("status"),
        t("duration"),
        t("cacheHit"),
      ]}
      rows={items.map((r) => (
        <TableRow key={r.id}>
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
            {r.query ?? <span className="text-muted-foreground">—</span>}
          </TableCell>
          <TableCell className="font-mono text-xs">
            {r.externalId ?? <span className="text-muted-foreground">—</span>}
          </TableCell>
          <TableCell>
            <Badge variant={statusVariant(r.status)} className="tabular-nums">
              {r.status}
            </Badge>
          </TableCell>
          <TableCell className="tabular-nums">{r.durationMs}ms</TableCell>
          <TableCell>
            {r.cacheHit ? (
              <Badge variant="info">{t("cacheHitYes")}</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        </TableRow>
      ))}
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
