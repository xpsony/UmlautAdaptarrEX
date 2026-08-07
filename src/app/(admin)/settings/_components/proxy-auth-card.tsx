"use client";

import { useTranslations } from "next-intl";
import type { FieldErrors, UseFormRegister, UseFormReset } from "react-hook-form";
import { Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldHint } from "@/components/ui/field-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/ui/copy-button";
import { RevealableInput } from "@/components/ui/revealable-input";
import { useRegenerateSecret } from "../_lib/use-regenerate-secret";
import type { GeneralFormInput, SettingsRow } from "../_lib/settings-types";

interface ProxyAuthCardProps {
  register: UseFormRegister<GeneralFormInput>;
  errors: FieldErrors<GeneralFormInput>;
  proxyPassword: string;
  reset: UseFormReset<GeneralFormInput>;
}

export function ProxyAuthCard({ register, errors, proxyPassword, reset }: ProxyAuthCardProps) {
  const t = useTranslations("settings");
  const regen = useRegenerateSecret<keyof SettingsRow>({
    endpoint: "/api/admin/settings/regenerate-proxy-password",
    field: "proxyPassword",
    successMessageKey: "proxyPasswordRegenerated",
    onAfterUpdate: (value) => {
      // Reset the form so the new password is reflected and the field
      // doesn't stay marked as "dirty".
      reset((current) => ({ ...current, proxyPassword: String(value) }), {
        keepDirty: false,
      });
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            {t("proxyAuth.title")}
          </CardTitle>
          <CardDescription>{t("proxyAuth.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="proxyUsername">{t("proxyAuth.username")}</Label>
              <Input id="proxyUsername" autoComplete="off" {...register("proxyUsername")} />
              {errors.proxyUsername ? (
                <p className="text-xs text-destructive">{errors.proxyUsername.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="proxyPassword">{t("proxyAuth.password")}</Label>
                <FieldHint text={t("proxyAuth.passwordHint")} />
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex-1">
                  <RevealableInput
                    id="proxyPassword"
                    autoComplete="off"
                    className="font-mono"
                    showLabel={t("showKey")}
                    hideLabel={t("hideKey")}
                    {...register("proxyPassword")}
                  />
                </div>
                <CopyButton value={proxyPassword} label={t("copy")} />
                <Button type="button" variant="outline" onClick={() => regen.setConfirming(true)}>
                  <RefreshCw className="h-4 w-4" />
                  {t("proxyAuth.regenerate")}
                </Button>
              </div>
              {errors.proxyPassword ? (
                <p className="text-xs text-destructive">{errors.proxyPassword.message}</p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={regen.confirming}
        onOpenChange={regen.setConfirming}
        title={t("proxyAuth.regenerateTitle")}
        description={t("proxyAuth.regenerateConfirm")}
        confirmLabel={t("proxyAuth.regenerate")}
        confirmIcon={<RefreshCw className="h-4 w-4" />}
        pending={regen.running}
        onConfirm={() => void regen.regenerate()}
      />
    </>
  );
}
