"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/app/_lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Item, MediaType } from "../_lib/library-types";

interface ItemDetailSheetProps {
  open: boolean;
  item: Item | null;
  onClose: () => void;
}

interface VariationSectionProps {
  title: string;
  values: string[];
}

function VariationSection({ title, values }: VariationSectionProps) {
  if (values.length === 0) return null;
  return (
    <details className="text-sm" open>
      <summary className="cursor-pointer font-medium">{title}</summary>
      <ul className="mt-2 space-y-1 pl-4">
        {values.map((value, index) => (
          <li key={index} className="font-mono text-xs">
            {value}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ItemDetailSheet({ open, item, onClose }: ItemDetailSheetProps) {
  const t = useTranslations("library");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const qc = useQueryClient();

  // The Sheet must stay mounted while `open` flips to false so Radix can run
  // its exit animation — the parent no longer unmounts this component on
  // close. `item` itself goes null the instant the parent clears its
  // selection, so keep the last-seen item around and render that while the
  // animation plays out. Adjusted during render (not in an effect) per the
  // React docs' "adjusting state when a prop changes" pattern — refs can't
  // be read during render, and an effect here would render one frame behind.
  const [lastItem, setLastItem] = useState<Item | null>(item);
  if (item && item !== lastItem) {
    setLastItem(item);
  }
  const shown = item ?? lastItem;

  // Reset the override field exactly once per "sheet opened for item X"
  // transition, using the same render-time-adjustment pattern. Deliberately
  // NOT re-syncing on every background-refetched `item.override` while the
  // sheet stays open for the same item — that would clobber in-progress
  // typing. Trade-off: an override edited elsewhere while this sheet is open
  // won't be picked up until it is reopened.
  const openKey = open && item ? item.id : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(openKey);
  const [value, setValue] = useState(item?.override ?? "");
  if (openKey !== syncedKey) {
    setSyncedKey(openKey);
    if (openKey !== null) setValue(item?.override ?? "");
  }

  const invalidateAndClose = (message: string) => {
    void qc.invalidateQueries({ queryKey: ["search-items"] });
    toast.success(message);
    onClose();
  };

  const saveMut = useMutation({
    mutationFn: (payload: { mediaType: MediaType; externalId: string; germanTitle: string }) =>
      apiFetch("/api/admin/title-overrides", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => invalidateAndClose(t("overrideSaved")),
    onError: () => toast.error(tCommon("error")),
  });

  const removeMut = useMutation({
    mutationFn: (payload: { mediaType: MediaType; externalId: string }) =>
      apiFetch(
        `/api/admin/title-overrides/${payload.mediaType}/${encodeURIComponent(payload.externalId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => invalidateAndClose(t("overrideRemoved")),
    onError: () => toast.error(tCommon("error")),
  });

  if (!shown) return null;

  const pending = saveMut.isPending || removeMut.isPending;
  const trimmed = value.trim();
  const saveDisabled = trimmed.length === 0 || trimmed === (shown.override ?? "") || pending;
  const showAuthor = shown.mediaType === "audio" || shown.mediaType === "book";

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
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // A pending mutation targets `shown`; if closing were allowed to go
        // through mid-flight, the parent could swap in a different item
        // before onSuccess fires, and the toast/invalidate/close would land
        // on the wrong context. Block the close until the mutation settles.
        if (!next && !pending) onClose();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{shown.expectedTitle}</SheetTitle>
          <SheetDescription>
            {typeLabel(shown.mediaType)}
            {shown.year !== null ? ` · ${shown.year}` : ""} · {shown.instance.name}
          </SheetDescription>
        </SheetHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("detailOriginalTitle")}</dt>
          <dd>{shown.title}</dd>

          {showAuthor && (
            <>
              <dt className="text-muted-foreground">{t("detailAuthor")}</dt>
              <dd>{shown.expectedAuthor ?? <span className="text-muted-foreground">—</span>}</dd>
            </>
          )}

          <dt className="text-muted-foreground">{t("colGermanTitle")}</dt>
          <dd>{shown.germanTitle ?? <span className="text-muted-foreground">—</span>}</dd>

          <dt className="text-muted-foreground">{t("detailExternalId")}</dt>
          <dd className="font-mono text-xs">{shown.externalId}</dd>

          <dt className="text-muted-foreground">{t("colUpdated")}</dt>
          <dd>{new Date(shown.updatedAt).toLocaleString(locale)}</dd>
        </dl>

        <div className="space-y-3">
          <VariationSection title={t("searchVariations")} values={shown.titleSearchVariations} />
          <VariationSection title={t("matchVariations")} values={shown.titleMatchVariations} />
          <VariationSection title={t("authorVariations")} values={shown.authorMatchVariations} />
          {shown.aliases && shown.aliases.length > 0 && (
            <VariationSection title={t("detailAliases")} values={shown.aliases} />
          )}
        </div>

        <form
          className="space-y-3 rounded-md border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saveDisabled) {
              saveMut.mutate({
                mediaType: shown.mediaType,
                externalId: shown.externalId,
                germanTitle: trimmed,
              });
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="override-input">{t("overrideLabel")}</Label>
            <Input
              id="override-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">{t("overrideHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saveDisabled}>
              {t("overrideSave")}
            </Button>
            {shown.override !== null && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  removeMut.mutate({
                    mediaType: shown.mediaType,
                    externalId: shown.externalId,
                  })
                }
              >
                {t("overrideRemove")}
              </Button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
