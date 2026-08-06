"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, ListChecks, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { useDebouncedValue } from "@/app/_lib/use-debounced-value";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";

interface Row {
  id: string;
  originalTitle: string;
  rewrittenTitle: string;
  mediaType: string;
  createdAt: string;
}

export function RenameHistoryClient() {
  const t = useTranslations("history.rename");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());

  const data = useQuery<{ items: Row[]; total: number }>({
    queryKey: ["rename-history", page, pageSize, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch(`/api/admin/rename-history?${params}`);
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
      emptyIcon={<ListChecks className="h-5 w-5" />}
      isLoading={data.isLoading}
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
      columns={[t("createdAt"), t("mediaType"), t("originalTitle"), t("rewrittenTitle")]}
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
