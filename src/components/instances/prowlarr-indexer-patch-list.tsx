"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ProwlarrIndexerView, ProwlarrOtherProxy } from "@/schemas/prowlarr";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IndexerPatchListProps {
  indexers: ProwlarrIndexerView[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (checked: boolean) => void;
  /** Indexers whose tags of other proxies should come off (opt-in). */
  detachIds: Set<number>;
  onToggleDetach: (id: number) => void;
}

// One entry per foreign proxy across all indexers, with the union of the tags
// it shares with them, e.g. "UmlautAdaptarr (Tag: umlautadaptarr)".
function collectOtherProxies(indexers: ProwlarrIndexerView[]): ProwlarrOtherProxy[] {
  const byName = new Map<string, Set<string>>();
  for (const ix of indexers) {
    for (const p of ix.otherProxies) {
      const tags = byName.get(p.name) ?? new Set<string>();
      for (const tag of p.tags) tags.add(tag);
      byName.set(p.name, tags);
    }
  }
  return Array.from(byName, ([name, tags]) => ({ name, tags: Array.from(tags) }));
}

// Shared, data-source-agnostic list used by both the settings dialog and the
// setup-wizard step. Renders the explainer callout, a select-all header and a
// row per indexer. Non-patchable indexers are rendered greyed out with the
// reason in a tooltip - but one that carries the proxy tag TODAY stays
// clickable, so a tag that should not be there can still be taken off here.
export function IndexerPatchList({
  indexers,
  selectedIds,
  onToggle,
  onToggleAll,
  detachIds,
  onToggleDetach,
}: IndexerPatchListProps): React.ReactElement {
  const t = useTranslations("settings.prowlarr");
  const [open, setOpen] = useState(false);

  const patchable = indexers.filter((i) => i.patchable);
  const allSelected = patchable.length > 0 && patchable.every((i) => selectedIds.has(i.id));
  const conflicted = indexers.filter((i) => i.otherProxies.length > 0);
  const otherProxies = collectOtherProxies(conflicted);

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

      {conflicted.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{t("patchOtherProxyTitle")}</p>
              <p>
                {t("patchOtherProxyBody", {
                  count: conflicted.length,
                  proxies: otherProxies
                    .map((p) =>
                      t("patchOtherProxyEntry", { name: p.name, tags: p.tags.join(", ") }),
                    )
                    .join("; "),
                })}
              </p>
            </div>
          </div>
        </div>
      ) : null}

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
              // Greyed out, but still operable while the tag is on it: without
              // this, an indexer that was tagged before it became non-patchable
              // could never be un-tagged from this dialog.
              const interactive = ix.patchable || ix.isPatched;
              const row = (
                <label
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm",
                    !ix.patchable && "opacity-60",
                    interactive ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(ix.id)}
                    disabled={!interactive}
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
              // Detaching only makes sense for an indexer that ends up on our
              // proxy; the server enforces the same rule.
              const canDetach = selectedIds.has(ix.id) && interactive;
              return (
                <li key={ix.id}>
                  {ix.patchable ? (
                    row
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent>
                        {ix.reason === "unsupported_api"
                          ? t("patchUnsupportedApi", {
                              implementation: ix.implementation ?? "?",
                            })
                          : t("patchNotPatchable")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {ix.otherProxies.length > 0 ? (
                    <div className="flex items-center gap-2 pr-3 pb-2 pl-10 text-xs text-amber-700 dark:text-amber-300">
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1">
                        {ix.otherProxies
                          .map((p) =>
                            t("patchOtherProxyLine", { name: p.name, tags: p.tags.join(", ") }),
                          )
                          .join("; ")}
                      </span>
                      <label
                        className={cn(
                          "flex items-center gap-1.5",
                          canDetach ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                        )}
                      >
                        <Checkbox
                          checked={canDetach && detachIds.has(ix.id)}
                          disabled={!canDetach}
                          onCheckedChange={() => onToggleDetach(ix.id)}
                        />
                        {t("patchOtherProxyRemove")}
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
