"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import type { ProwlarrParsedApp, ProwlarrSkippedApp } from "@/schemas/prowlarr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProwlarrAppSelectionList } from "@/components/instances/prowlarr-app-selection-list";
import type { AppRowState, OperationMode } from "../_lib/setup-wizard";

interface ProwlarrImportStepProps {
  apps: ProwlarrParsedApp[];
  skippedApps: ProwlarrSkippedApp[];
  selectedAppIds: Set<number>;
  appRows: Map<number, AppRowState>;
  operationMode: OperationMode;
  isSubmitting: boolean;
  onToggleApp: (id: number) => void;
  onUpdateAppRow: (id: number, patch: Partial<AppRowState>) => void;
  onTestAppRow: (app: ProwlarrParsedApp) => void;
  onBack: () => void;
  onNext: () => void;
}

export function ProwlarrImportStep({
  apps,
  skippedApps,
  selectedAppIds,
  appRows,
  operationMode,
  isSubmitting,
  onToggleApp,
  onUpdateAppRow,
  onTestAppRow,
  onBack,
  onNext,
}: ProwlarrImportStepProps) {
  const t = useTranslations("setup");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("step3Title")}</CardTitle>
          <CardDescription>{t("step3Hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProwlarrAppSelectionList
            apps={apps}
            skippedApps={skippedApps}
            selectedAppIds={selectedAppIds}
            appRows={appRows}
            onToggleApp={onToggleApp}
            onUpdateAppRow={onUpdateAppRow}
            onTestAppRow={onTestAppRow}
          />
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <Button type="button" onClick={onNext} disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {operationMode === "legacy" ? t("submit") : t("nextStep")}
        </Button>
      </div>
    </div>
  );
}
