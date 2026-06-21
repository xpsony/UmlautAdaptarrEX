"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
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
          <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50 p-3 text-xs dark:border-amber-700/40 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <p>{t("operationMode.restartHint", { legacyApiPort, proxyPort })}</p>
          </div>
        ) : null}
        {!dirty && restartRequired ? (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-amber-300/40 bg-amber-50 p-3 text-xs dark:border-amber-700/40 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <p>{t("operationMode.restartPending", { proxyPort })}</p>
            </div>
            <RestartServerButton variant="outline" size="sm" />
          </div>
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
