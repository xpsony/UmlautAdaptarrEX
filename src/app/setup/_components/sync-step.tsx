"use client";

import { useTranslations } from "next-intl";
import { Loader2, RefreshCw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SyncStepProps {
  instanceCount: number;
  submitting: boolean;
  onStart: () => void;
  onSkip: () => void;
}

export function SyncStep({ instanceCount, submitting, onStart, onSkip }: SyncStepProps) {
  const t = useTranslations("setup");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("syncStepTitle")}</CardTitle>
          <CardDescription>{t("syncStepHint", { count: instanceCount })}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>{t("syncStepBody")}</p>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onSkip} disabled={submitting}>
          <SkipForward className="h-4 w-4" />
          {t("syncStepSkip")}
        </Button>
        <Button type="button" onClick={onStart} disabled={submitting}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("syncStepStart")}
        </Button>
      </div>
    </div>
  );
}
