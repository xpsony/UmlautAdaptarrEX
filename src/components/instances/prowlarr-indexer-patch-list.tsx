"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Info, ShieldCheck } from "lucide-react";
import type { ProwlarrIndexerView } from "@/schemas/prowlarr";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IndexerPatchListProps {
  indexers: ProwlarrIndexerView[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (checked: boolean) => void;
}

// Shared, data-source-agnostic list used by both the settings dialog and the
// setup-wizard step. Renders the explainer callout, a select-all header and a
// row per indexer. Non-patchable indexers are rendered disabled with a reason.
export function IndexerPatchList({
  indexers,
  selectedIds,
  onToggle,
  onToggleAll,
}: IndexerPatchListProps): React.ReactElement {
  const t = useTranslations("settings.prowlarr");
  const [open, setOpen] = useState(false);

  const patchable = indexers.filter((i) => i.patchable);
  const allSelected = patchable.length > 0 && patchable.every((i) => selectedIds.has(i.id));

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">{t("patchWhyTitle")}</p>
            <p>{t("patchWhyBody")}</p>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
              {t("patchMore")}
            </button>
            {open ? (
              <div className="mt-1 flex items-start gap-2 border-t border-sky-500/30 pt-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{t("patchSafeTitle")}</p>
                  <p>{t("patchSafeBody")}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {indexers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("patchEmpty")}</p>
      ) : (
        <div className="rounded-md border">
          <label className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-sm font-medium">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(c) => onToggleAll(c === true)}
              disabled={patchable.length === 0}
            />
            {t("patchSelectAll")}
          </label>
          <ul className="max-h-72 divide-y overflow-y-auto">
            {indexers.map((ix) => {
              const row = (
                <label
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm",
                    ix.patchable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(ix.id)}
                    disabled={!ix.patchable}
                    onCheckedChange={() => onToggle(ix.id)}
                  />
                  <span className="flex-1 truncate">{ix.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {ix.protocol}
                  </Badge>
                  <Badge variant={ix.isPatched ? "default" : "secondary"} className="text-[10px]">
                    {ix.isPatched ? t("patchStatusPatched") : t("patchStatusUnpatched")}
                  </Badge>
                </label>
              );
              return (
                <li key={ix.id}>
                  {ix.patchable ? (
                    row
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent>{t("patchNotPatchable")}</TooltipContent>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
