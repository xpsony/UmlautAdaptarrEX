"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Server } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/error-format";
import type { IndexerListEntry, IndexerVariationSetting } from "@/schemas/indexer-setting";
import { useIndexerSettings } from "../_lib/use-indexer-settings";
import { VARIATION_TYPES, type SearchBehaviourValues } from "../_lib/settings-types";

interface IndexerVariationCardProps {
  /** The global switches and caps; a new custom setting starts from these. */
  global: SearchBehaviourValues;
}

interface CapInputProps {
  value: number;
  disabled: boolean;
  label: string;
  onCommit: (value: number) => void;
}

// Commits on blur or Enter rather than per keystroke: every commit is one
// PUT, and typing "12" would otherwise save 1 first. An invalid entry falls
// back to the stored value. The parent keys it on the stored value, so a
// saved change resets the draft.
function CapInput({ value, disabled, label, onCommit }: CapInputProps) {
  const [draft, setDraft] = useState(String(value));
  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < 0 || n > 20) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <Input
      type="number"
      min={0}
      max={20}
      value={draft}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-7 w-14 px-2 text-xs"
    />
  );
}

// Saves on every change rather than through the tab's save bar: each toggle
// or cap writes one IndexerSetting row, and mixing that with the form's dirty state
// would make "Save" mean two different things.
export function IndexerVariationCard({ global }: IndexerVariationCardProps) {
  const t = useTranslations("settings.indexerVariations");
  const tTypes = useTranslations("searchBehaviour.variations");
  const locale = useLocale();
  const { query, save } = useIndexerSettings();

  const persist = (host: string, setting: IndexerVariationSetting | null): void => {
    save.mutate(
      { host, setting },
      {
        onSuccess: () => toast.success(t("saved")),
        onError: (err) => toast.error(t("saveFailed", { error: describeError(err) })),
      },
    );
  };

  const fromGlobal = (): IndexerVariationSetting => ({
    tv: global.tvVariationSearch,
    movie: global.movieVariationSearch,
    audio: global.audioVariationSearch,
    book: global.bookVariationSearch,
    tvMax: global.tvMaxTitleVariations,
    movieMax: global.movieMaxTitleVariations,
    audioMax: global.audioMaxTitleVariations,
    bookMax: global.bookMaxTitleVariations,
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
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {VARIATION_TYPES.map(({ mediaType, toggle }) => {
            const capKey = `${mediaType}Max` as const;
            const label = tTypes(toggle);
            return (
              <div
                key={mediaType}
                className={
                  custom ? "flex items-center gap-2" : "flex items-center gap-2 opacity-60"
                }
              >
                <label
                  className={
                    custom
                      ? "flex cursor-pointer items-center gap-1.5 text-xs"
                      : "flex cursor-not-allowed items-center gap-1.5 text-xs"
                  }
                >
                  <Checkbox
                    checked={effective[mediaType]}
                    disabled={!custom || save.isPending}
                    onCheckedChange={(c) =>
                      persist(ix.host, { ...effective, [mediaType]: c === true })
                    }
                  />
                  {label}
                </label>
                <CapInput
                  key={`${ix.host}-${capKey}-${effective[capKey]}`}
                  value={effective[capKey]}
                  disabled={!custom || !effective[mediaType] || save.isPending}
                  label={tTypes("capAria", { type: label })}
                  onCommit={(n) => persist(ix.host, { ...effective, [capKey]: n })}
                />
              </div>
            );
          })}
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
