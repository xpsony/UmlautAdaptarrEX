"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationModePicker } from "@/components/operation-mode-picker";
import type { OperationMode } from "../_lib/setup-wizard";

interface ModeStepProps {
  value: OperationMode;
  onChange: (value: OperationMode) => void;
  legacyApiPort: number;
  proxyPort: number;
  onBack: () => void;
  onNext: () => void;
}

export function ModeStep({
  value,
  onChange,
  legacyApiPort,
  proxyPort,
  onBack,
  onNext,
}: ModeStepProps) {
  const t = useTranslations("setup");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("modeTitle")}</CardTitle>
          <CardDescription>{t("modeHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <OperationModePicker
            value={value}
            onChange={onChange}
            legacyApiPort={legacyApiPort}
            proxyPort={proxyPort}
          />
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <Button type="button" onClick={onNext}>
          {t("nextStep")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
