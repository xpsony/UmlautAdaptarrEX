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
import { httpStatusVariant } from "@/app/(admin)/_lib/status-variant";
import type { RequestHistoryRow } from "../_lib/request-history-types";

interface RequestDetailSheetProps {
  open: boolean;
  item: RequestHistoryRow | null;
  onClose: () => void;
}

export function RequestDetailSheet({ open, item, onClose }: RequestDetailSheetProps) {
  const t = useTranslations("history.request");
  const locale = useLocale();

  // The Sheet must stay mounted while `open` flips to false so Radix can run
  // its exit animation - the parent no longer unmounts this component on
  // close. `item` itself goes null the instant the parent clears its
  // selection, so keep the last-seen item around and render that while the
  // animation plays out. Adjusted during render (not in an effect) per the
  // React docs' "adjusting state when a prop changes" pattern - refs can't be
  // read during render, and an effect here would render one frame behind.
  const [lastItem, setLastItem] = useState<RequestHistoryRow | null>(item);
  if (item && item !== lastItem) {
    setLastItem(item);
  }
  const shown = item ?? lastItem;

  if (!shown) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("detailTitle")}</SheetTitle>
          <SheetDescription>
            <span className="capitalize">{shown.type}</span> ·{" "}
            {new Date(shown.createdAt).toLocaleString(locale)}
          </SheetDescription>
        </SheetHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("type")}</dt>
          <dd className="capitalize">{shown.type}</dd>

          <dt className="text-muted-foreground">{t("domain")}</dt>
          <dd className="font-mono text-xs break-all">{shown.domain}</dd>

          <dt className="text-muted-foreground">{t("externalId")}</dt>
          <dd className="font-mono text-xs break-all">
            {shown.externalId ?? <span className="text-muted-foreground">-</span>}
          </dd>

          <dt className="text-muted-foreground">{t("status")}</dt>
          <dd>
            <Badge variant={httpStatusVariant(shown.status)} className="tabular-nums">
              {shown.status}
            </Badge>
          </dd>

          <dt className="text-muted-foreground">{t("duration")}</dt>
          <dd className="tabular-nums">{shown.durationMs}ms</dd>

          <dt className="text-muted-foreground">{t("cacheHit")}</dt>
          <dd>
            {shown.cacheHit ? (
              <Badge variant="info">{t("cacheHitYes")}</Badge>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </dd>

          <dt className="text-muted-foreground">{t("createdAt")}</dt>
          <dd>{new Date(shown.createdAt).toLocaleString(locale)}</dd>
        </dl>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">{t("query")}</p>
          <p className="font-mono text-xs break-all">
            {shown.query ?? <span className="text-muted-foreground">-</span>}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
