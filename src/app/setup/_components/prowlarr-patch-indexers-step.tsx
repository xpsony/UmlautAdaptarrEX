"use client";

import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import type { ProwlarrIndexerView } from "@/schemas/prowlarr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IndexerPatchList } from "@/components/instances/prowlarr-indexer-patch-list";

interface ProwlarrPatchIndexersStepProps {
  indexers: ProwlarrIndexerView[];
  selectedIds: Set<number>;
  loading: boolean;
  submitting: boolean;
  onToggle: (id: number) => void;
  onToggleAll: (checked: boolean) => void;
  onSkip: () => void;
  onSubmit: () => void;
}

export function ProwlarrPatchIndexersStep({
  indexers,
  selectedIds,
  loading,
  submitting,
  onToggle,
  onToggleAll,
  onSkip,
  onSubmit,
}: ProwlarrPatchIndexersStepProps): React.ReactElement {
  const t = useTranslations("settings.prowlarr");
  const tSetup = useTranslations("setup");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("patchTitle")}</CardTitle>
        <CardDescription>{t("patchDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <IndexerPatchList
            indexers={indexers}
            selectedIds={selectedIds}
            onToggle={onToggle}
            onToggleAll={onToggleAll}
          />
        )}
      </CardContent>
      <CardContent className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={onSkip} disabled={submitting}>
          {tSetup("patchStepSkip")}
        </Button>
        <Button onClick={onSubmit} disabled={submitting || loading}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("patchApply")}
        </Button>
      </CardContent>
    </Card>
  );
}
