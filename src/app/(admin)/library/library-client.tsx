"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { useDebouncedValue } from "@/app/_lib/use-debounced-value";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Instance } from "@/app/(admin)/instances/_lib/instances-types";
import { ItemDetailSheet } from "./_components/item-detail-sheet";

type MediaType = "tv" | "movie" | "audio" | "book";

interface Item {
  id: string;
  arrId: number;
  externalId: string;
  title: string;
  expectedTitle: string;
  expectedAuthor: string | null;
  germanTitle: string | null;
  mediaType: MediaType;
  year: number | null;
  titleSearchVariations: string[];
  titleMatchVariations: string[];
  authorMatchVariations: string[];
  aliases: string[] | null;
  updatedAt: string;
  instance: { id: string; name: string; type: string };
  override: string | null;
}

// shadcn Select can't carry an empty-string item value, so "all" is the
// sentinel for "no filter" and is simply omitted from the query params.
const ALL = "all";

const MEDIA_TYPES: MediaType[] = ["tv", "movie", "audio", "book"];

export function LibraryClient() {
  const t = useTranslations("library");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [instanceFilter, setInstanceFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [missingOnly, setMissingOnly] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null);

  const instances = useQuery<Instance[]>({
    queryKey: ["instances"],
    queryFn: () => apiFetch<Instance[]>("/api/admin/instances"),
  });

  const data = useQuery<{ items: Item[]; total: number }>({
    queryKey: [
      "search-items",
      page,
      pageSize,
      debouncedSearch,
      instanceFilter,
      typeFilter,
      missingOnly,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (instanceFilter !== ALL) params.set("instanceId", instanceFilter);
      if (typeFilter !== ALL) params.set("mediaType", typeFilter);
      if (missingOnly) params.set("missingGerman", "1");
      return apiFetch(`/api/admin/search-items?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  const typeLabel = (type: MediaType): string => {
    switch (type) {
      case "tv":
        return t("typeTv");
      case "movie":
        return t("typeMovie");
      case "audio":
        return t("typeAudio");
      case "book":
        return t("typeBook");
    }
  };

  return (
    <>
      <HistoryPage
        title={t("title")}
        subtitle={t("subtitle")}
        listTitle={t("listTitle", { count: total })}
        listSubtitle={t("listSubtitle")}
        emptyTitle={t("emptyTitle")}
        emptyHint={t("emptyHint")}
        emptyIcon={<BookOpen className="h-5 w-5" />}
        isLoading={data.isLoading}
        isError={data.isLoadingError}
        errorLabel={tCommon("error")}
        retryLabel={tBoundaries("retry")}
        onRetry={() => void data.refetch()}
        retryPending={data.isFetching}
        isEmpty={items.length === 0}
        filterSlot={
          <div className="flex flex-wrap items-center gap-2">
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
              value={instanceFilter}
              onValueChange={(v) => {
                setInstanceFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40" aria-label={t("allInstances")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allInstances")}</SelectItem>
                {(instances.data ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36" aria-label={t("allTypes")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allTypes")}</SelectItem>
                {MEDIA_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {typeLabel(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id="missing-german-only"
                checked={missingOnly}
                onCheckedChange={(v) => {
                  setMissingOnly(v);
                  setPage(1);
                }}
              />
              <Label htmlFor="missing-german-only" className="font-normal whitespace-nowrap">
                {t("missingGermanOnly")}
              </Label>
            </div>
          </div>
        }
        columns={[
          t("colTitle"),
          t("colGermanTitle"),
          t("colType"),
          t("colYear"),
          t("colInstance"),
          t("colUpdated"),
        ]}
        rows={items.map((item) => (
          <TableRow
            key={item.id}
            className="cursor-pointer focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            tabIndex={0}
            role="button"
            aria-label={item.expectedTitle}
            onClick={() => setDetail(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDetail(item);
              }
            }}
          >
            <TableCell className="max-w-xs truncate font-medium" title={item.expectedTitle}>
              {item.expectedTitle}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                {item.germanTitle ? (
                  <span className="max-w-xs truncate" title={item.germanTitle}>
                    {item.germanTitle}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                {item.override !== null && <Badge variant="info">{t("overrideBadge")}</Badge>}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{typeLabel(item.mediaType)}</Badge>
            </TableCell>
            <TableCell className="tabular-nums">
              {item.year ?? <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell>{item.instance.name}</TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {new Date(item.updatedAt).toLocaleString(locale)}
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
      {detail ? <ItemDetailSheet item={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}
