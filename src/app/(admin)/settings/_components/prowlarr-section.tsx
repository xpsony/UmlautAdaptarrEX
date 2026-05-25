"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Loader2,
  Pencil,
  Plug,
  Unplug,
  X,
  XCircle,
} from "lucide-react";
import { ProwlarrInstallProxyDialog } from "@/components/instances/prowlarr-install-proxy-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RevealableInput } from "@/components/ui/revealable-input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProwlarrConfig } from "../_lib/use-prowlarr-config";

export function ProwlarrSection() {
  const t = useTranslations("settings.prowlarr");
  const w = useProwlarrConfig();
  const { register, handleSubmit, formState } = w.form;

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  // Stored mode: render the "Connected to ..." badge plus a Replace button.
  // Editing mode: render the host/apiKey inputs plus a Cancel button (only
  // when there is a stored config to fall back to).
  const showStored = w.isConfigured && !w.editing;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {w.config.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : showStored ? (
          <>
            <div className="flex items-center gap-2">
              <div
                className="flex h-9 flex-1 items-center gap-2 rounded-md border border-input bg-muted/50 px-3 text-sm"
                role="status"
              >
                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-muted-foreground">
                  {t("statusConfigured")}
                </span>
                <span className="font-mono text-foreground">
                  {w.config.data?.host}
                </span>
              </div>
              <Button type="button" variant="outline" onClick={w.beginEdit}>
                <Pencil className="h-4 w-4" />
                {t("replace")}
              </Button>
            </div>
            {w.testResult ? (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                  w.testResult.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                {w.testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <span>{w.testResult.message}</span>
              </div>
            ) : null}
          </>
        ) : (
          <form
            id="prowlarr-form"
            onSubmit={handleSubmit((d) => w.saveMut.mutate(d))}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="prowlarr-host">{t("host")}</Label>
              <Input
                id="prowlarr-host"
                placeholder={t("hostPlaceholder")}
                {...register("host")}
              />
              {formState.errors.host ? (
                <p className="text-xs text-destructive">
                  {formState.errors.host.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="prowlarr-apikey">{t("apiKey")}</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <RevealableInput
                    id="prowlarr-apikey"
                    autoComplete="off"
                    placeholder={t("apiKeyPlaceholder")}
                    showLabel={t("apiKey")}
                    hideLabel={t("apiKey")}
                    {...register("apiKey")}
                  />
                </div>
                {w.isConfigured ? (
                  <Button type="button" variant="ghost" onClick={w.cancelEdit}>
                    <X className="h-4 w-4" />
                    {t("cancelReplace")}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t("apiKeyHint")}</p>
              {formState.errors.apiKey ? (
                <p className="text-xs text-destructive">
                  {formState.errors.apiKey.message}
                </p>
              ) : null}
            </div>

            {w.testResult ? (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                  w.testResult.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                {w.testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <span>{w.testResult.message}</span>
              </div>
            ) : null}
          </form>
        )}
      </CardContent>
      <CardContent className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            // Editing: submit the form so RHF validates host/apiKey before the
            // round-trip. Stored: bypass the form and ask the server to use
            // the persisted credentials (useStored:true), since the operator
            // hasn't typed anything.
            onClick={
              w.editing
                ? handleSubmit((d) => w.test(d))
                : () => void w.test(null)
            }
            disabled={
              w.testing ||
              w.saveMut.isPending ||
              (w.editing ? !w.canSubmit : !w.isConfigured)
            }
          >
            {w.testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-4 w-4" />
            )}
            {t("test")}
          </Button>
          {w.hostValue.trim().length > 0 ? (
            <Button
              asChild
              type="button"
              variant="outline"
              title={t("openProwlarrSettings")}
            >
              <a
                href={`${w.hostValue.replace(/\/+$/, "")}/settings/general`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("openProwlarrSettings")}
              >
                <ExternalLink className="h-4 w-4" />
                {t("openProwlarrSettings")}
              </a>
            </Button>
          ) : null}
          {w.isConfigured ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setInstallOpen(true)}
            >
              <CloudUpload className="h-4 w-4" />
              {t("installProxy")}
            </Button>
          ) : null}
          {w.isConfigured ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDisconnect(true)}
              disabled={w.disconnectMut.isPending || w.saveMut.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Unplug className="h-4 w-4" />
              {t("disconnect")}
            </Button>
          ) : null}
        </div>
        {w.editing ? (
          <Button type="submit" form="prowlarr-form" disabled={!w.canSubmit}>
            {w.saveMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("save")}
          </Button>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t("disconnectTitle")}
        description={t("disconnectConfirm")}
        confirmLabel={t("disconnect")}
        confirmIcon={<Unplug className="h-4 w-4" />}
        destructive
        pending={w.disconnectMut.isPending}
        onConfirm={() =>
          w.disconnectMut.mutate(undefined, {
            onSuccess: () => setConfirmDisconnect(false),
          })
        }
      />

      <ProwlarrInstallProxyDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
      />
    </Card>
  );
}
