"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ArrIcon, type ArrIconType } from "@/components/ui/arr-icon";
import { syncStatusVariant } from "@/app/(admin)/_lib/status-variant";
import type { SyncRun } from "@/app/(admin)/_lib/sync-types";

interface RunDetailSheetProps {
  open: boolean;
  run: SyncRun | null;
  onClose: () => void;
}

export function RunDetailSheet({ open, run, onClose }: RunDetailSheetProps) {
  const t = useTranslations("syncRuns");
  const locale = useLocale();

  // The Sheet must stay mounted while `open` flips to false so Radix can run
  // its exit animation — the parent no longer unmounts this component on
  // close. `run` itself goes null the instant the parent clears its
  // selection, so keep the last-seen run around and render that while the
  // animation plays out. Adjusted during render (not in an effect) per the
  // React docs' "adjusting state when a prop changes" pattern — refs can't be
  // read during render, and an effect here would render one frame behind.
  const [lastRun, setLastRun] = useState<SyncRun | null>(run);
  if (run && run !== lastRun) {
    setLastRun(run);
  }
  const shown = run ?? lastRun;

  if (!shown) return null;

  const duration =
    shown.finishedAt && shown.startedAt
      ? Math.max(0, new Date(shown.finishedAt).getTime() - new Date(shown.startedAt).getTime())
      : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{shown.arrInstance?.name ?? t("detailUnknownInstance")}</SheetTitle>
          <SheetDescription className="capitalize">
            {shown.arrInstance?.type ?? <span className="text-muted-foreground">—</span>}
          </SheetDescription>
        </SheetHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("colInstance")}</dt>
          <dd>
            {shown.arrInstance ? (
              <div className="flex items-center gap-2">
                <ArrIcon type={shown.arrInstance.type as ArrIconType} size={18} />
                <span className="font-medium">{shown.arrInstance.name}</span>
                <Badge variant="outline" className="capitalize">
                  {shown.arrInstance.type}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </dd>

          <dt className="text-muted-foreground">{t("colStatus")}</dt>
          <dd>
            <Badge variant={syncStatusVariant(shown.status)} className="capitalize">
              {shown.status}
            </Badge>
          </dd>

          <dt className="text-muted-foreground">{t("colStarted")}</dt>
          <dd>{new Date(shown.startedAt).toLocaleString(locale)}</dd>

          <dt className="text-muted-foreground">{t("detailFinishedAt")}</dt>
          <dd>
            {shown.finishedAt ? (
              new Date(shown.finishedAt).toLocaleString(locale)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </dd>

          <dt className="text-muted-foreground">{t("colDuration")}</dt>
          <dd className="tabular-nums">
            {duration === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              `${(duration / 1000).toFixed(1)}s`
            )}
          </dd>

          <dt className="text-muted-foreground">{t("colItems")}</dt>
          <dd className="tabular-nums">{shown.itemsCount}</dd>

          <dt className="text-muted-foreground">{t("colPcjones")}</dt>
          <dd className="tabular-nums">{shown.pcjonesItemsCount}</dd>

          <dt className="text-muted-foreground">{t("colTvdb")}</dt>
          <dd className="tabular-nums">{shown.tvdbItemsCount}</dd>

          <dt className="text-muted-foreground">{t("colTmdb")}</dt>
          <dd className="tabular-nums">{shown.tmdbItemsCount}</dd>
        </dl>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">{t("colError")}</p>
          <p className="text-xs break-all text-destructive">
            {shown.errorMessage ?? <span className="text-muted-foreground">—</span>}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
