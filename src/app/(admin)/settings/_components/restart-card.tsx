"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Power } from "lucide-react";
import { RestartServerButton, useCanRestart } from "@/components/restart-server-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function RestartCard() {
  const t = useTranslations("settings.restart");
  const canRestart = useCanRestart();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Power className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canRestart ? (
          // Standing condition (platform capability), not a transient event -
          // role="status" instead of the warning variant's default "alert".
          <Alert variant="warning" role="status">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{t("unsupported")}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex justify-end">
          <RestartServerButton />
        </div>
      </CardContent>
    </Card>
  );
}
