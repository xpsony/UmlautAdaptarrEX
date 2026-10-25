"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IndexerPatchList } from "@/components/instances/prowlarr-indexer-patch-list";
import { toastPatchResult } from "@/components/instances/prowlarr-patch-summary";
import { useProwlarrIndexers } from "@/app/(admin)/settings/_lib/use-prowlarr-indexers";

interface ProwlarrIndexerPatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProwlarrIndexerPatchDialog({
  open,
  onOpenChange,
}: ProwlarrIndexerPatchDialogProps): React.ReactElement {
  const t = useTranslations("settings.prowlarr");
  const tCommon = useTranslations("common");
  const { query, patchMut } = useProwlarrIndexers(open);

  // `override === null` means "user hasn't touched the selection yet"; the
  // effective selection then falls back to all patchable indexers (the
  // "select all" default). This mirrors the install dialog's editedHost
  // pattern and avoids a setState-in-effect cascade.
  const [override, setOverride] = useState<Set<number> | null>(null);
  // Opt-in per indexer, empty by default: other proxies' tags stay untouched
  // unless the user ticks "remove" for that indexer.
  const [detach, setDetach] = useState<Set<number>>(new Set());

  const allPatchable = useMemo(
    () => new Set((query.data?.indexers ?? []).filter((i) => i.patchable).map((i) => i.id)),
    [query.data],
  );
  const selected = override ?? allPatchable;

  const toggle = (id: number): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOverride(next);
  };
  const toggleAll = (checked: boolean): void => {
    setOverride(checked ? new Set(allPatchable) : new Set());
  };
  const toggleDetach = (id: number): void => {
    const next = new Set(detach);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDetach(next);
  };

  const apply = (): void => {
    const selectedIds = Array.from(selected);
    const detachIds = selectedIds.filter((id) => detach.has(id));
    patchMut.mutate(
      { selectedIds, detachIds },
      {
        onSuccess: (res) => {
          toastPatchResult(t, res);
          onOpenChange(false);
        },
        onError: (err) =>
          toast.error(
            t("patchLoadFailed", {
              error: err instanceof Error ? err.message : "unknown",
            }),
          ),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setOverride(null);
          setDetach(new Set());
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("patchTitle")}</DialogTitle>
          <DialogDescription>{t("patchDescription")}</DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : query.isError ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              {t("patchLoadFailed", {
                error: query.error instanceof Error ? query.error.message : "unknown",
              })}
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("patchRetry")}
            </Button>
          </div>
        ) : (
          <IndexerPatchList
            indexers={query.data?.indexers ?? []}
            selectedIds={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            detachIds={detach}
            onToggleDetach={toggleDetach}
          />
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={patchMut.isPending}
          >
            {tCommon("cancel")}
          </Button>
          <Button onClick={apply} disabled={patchMut.isPending || query.isLoading || query.isError}>
            {patchMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {patchMut.isPending ? t("patchApplying") : t("patchApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
