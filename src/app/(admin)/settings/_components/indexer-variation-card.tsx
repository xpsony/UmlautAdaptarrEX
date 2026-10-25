"use client";

import { useLocale, useTranslations } from "next-intl";
import { Server } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/error-format";
import type { IndexerListEntry, IndexerSwitches } from "@/schemas/indexer-setting";
import { useIndexerSettings } from "../_lib/use-indexer-settings";
import type { SearchBehaviourValues } from "../_lib/settings-types";

// Row switch key -> label key under searchBehaviour.variations.
const TYPES = [
  ["tv", "tvVariationSearch"],
  ["movie", "movieVariationSearch"],
  ["audio", "audioVariationSearch"],
  ["book", "bookVariationSearch"],
] as const;

interface IndexerVariationCardProps {
  /** The global switches; a new custom setting starts from these. */
  global: SearchBehaviourValues;
}

// Saves on every change rather than through the tab's save bar: each toggle
// writes one IndexerSetting row, and mixing that with the form's dirty state
// would make "Save" mean two different things.
export function IndexerVariationCard({ global }: IndexerVariationCardProps) {
  const t = useTranslations("settings.indexerVariations");
  const tTypes = useTranslations("searchBehaviour.variations");
  const locale = useLocale();
  const { query, save } = useIndexerSettings();

  const persist = (host: string, switches: IndexerSwitches | null): void => {
    save.mutate(
      { host, switches },
      {
        onSuccess: () => toast.success(t("saved")),
        onError: (err) => toast.error(t("saveFailed", { error: describeError(err) })),
      },
    );
  };

  const fromGlobal = (): IndexerSwitches => ({
    tv: global.tvVariationSearch,
    movie: global.movieVariationSearch,
    audio: global.audioVariationSearch,
    book: global.bookVariationSearch,
  });

  const row = (ix: IndexerListEntry) => {
    const custom = ix.custom !== null;
    const effective = ix.custom ?? fromGlobal();
    const lastSearch = ix.lastSearchAt
      ? t("lastSearch", {
          date: new Date(ix.lastSearchAt).toLocaleString(locale, { dateStyle: "medium" }),
        })
      : t("neverSearched");
    return (
      <li key={ix.host} className="space-y-2 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{ix.name ?? ix.host}</p>
            <p className="text-xs break-words text-muted-foreground">
              {ix.name ? `${ix.host} · ${lastSearch}` : lastSearch}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Label htmlFor={`indexer-custom-${ix.host}`} className="text-xs">
              {t("custom")}
            </Label>
            <Switch
              id={`indexer-custom-${ix.host}`}
              checked={custom}
              disabled={save.isPending}
              onCheckedChange={(on) => persist(ix.host, on ? fromGlobal() : null)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TYPES.map(([key, label]) => (
            <label
              key={key}
              className={
                custom
                  ? "flex cursor-pointer items-center gap-1.5 text-xs"
                  : "flex cursor-not-allowed items-center gap-1.5 text-xs opacity-60"
              }
            >
              <Checkbox
                checked={effective[key]}
                disabled={!custom || save.isPending}
                onCheckedChange={(c) => persist(ix.host, { ...effective, [key]: c === true })}
              />
              {tTypes(label)}
            </label>
          ))}
        </div>
      </li>
    );
  };

  const indexers = query.data?.indexers ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            {t("loadFailed", { error: describeError(query.error) })}
          </p>
        ) : indexers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">{indexers.map(row)}</ul>
        )}
      </CardContent>
    </Card>
  );
}
