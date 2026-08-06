"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationModePicker, type OperationMode } from "@/components/operation-mode-picker";
import { RestartServerButton, useCanRestart } from "@/components/restart-server-button";
import type { OperationModeResponse } from "../_lib/settings-types";

export function OperationModeCard() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tSetup = useTranslations("setup");
  const qc = useQueryClient();
  const canRestart = useCanRestart();

  const settings = useQuery<OperationModeResponse>({
    queryKey: ["settings"],
    queryFn: () => apiFetch<OperationModeResponse>("/api/admin/settings"),
  });

  const [pending, setPending] = useState<OperationMode | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const stored = settings.data?.operationMode ?? "proxy";
  const value = pending ?? stored;
  const dirty = pending !== null && pending !== stored;
  // Resolved ports (env override > DB/default) come from the settings API; the
  // literal fallbacks match the defaults in src/lib/ports.ts.
  const legacyApiPort = settings.data?.legacyApiPort ?? 5005;
  const proxyPort = settings.data?.proxyPort ?? 5006;

  const saveMut = useMutation({
    mutationFn: (next: OperationMode) =>
      apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ operationMode: next }),
      }),
    onSuccess: () => {
      toast.success(t("operationMode.saved"));
      setPending(null);
      setRestartRequired(true);
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error(tCommon("error")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tSetup("modeTitle")}</CardTitle>
        <CardDescription>{tSetup("modeHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <OperationModePicker
          value={value}
          onChange={(m) => setPending(m)}
          legacyApiPort={legacyApiPort}
          proxyPort={proxyPort}
        />
        {dirty ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t("operationMode.restartHint", { legacyApiPort, proxyPort })}
            </AlertDescription>
          </Alert>
        ) : null}
        {!dirty && restartRequired ? (
          <Alert variant="warning" className="flex-wrap justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t("operationMode.restartPending", { proxyPort })}
              </AlertDescription>
            </div>
            <RestartServerButton variant="outline" size="sm" />
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPending(null)}
              disabled={saveMut.isPending}
            >
              {tCommon("cancel")}
            </Button>
          ) : null}
          {dirty && canRestart ? (
            <RestartServerButton
              variant="default"
              label={t("operationMode.saveAndRestart")}
              beforeRestart={async () => {
                if (pending) await saveMut.mutateAsync(pending);
              }}
              disabled={saveMut.isPending}
            />
          ) : null}
          <Button
            type="button"
            variant={dirty && canRestart ? "outline" : "default"}
            onClick={() => pending && saveMut.mutate(pending)}
            disabled={!dirty || saveMut.isPending}
          >
            {saveMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("operationMode.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
