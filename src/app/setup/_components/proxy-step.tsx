"use client";

import type { FormEventHandler } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { ArrowLeft, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RevealableInput } from "@/components/ui/revealable-input";
import type { ProxyFormInput } from "../_lib/setup-wizard";

interface ProxyStepProps {
  form: UseFormReturn<ProxyFormInput>;
  prowlarrConnected: boolean;
  isSubmitting: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onBack: () => void;
  onRegeneratePassword: () => void;
}

export function ProxyStep({
  form,
  prowlarrConnected,
  isSubmitting,
  onSubmit,
  onBack,
  onRegeneratePassword,
}: ProxyStepProps) {
  const t = useTranslations("setup");

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("step4Title")}</CardTitle>
          <CardDescription>{t("step4Hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="proxyUsername">{t("proxyUsername")}</Label>
              <Input
                id="proxyUsername"
                autoComplete="off"
                aria-invalid={form.formState.errors.proxyUsername ? true : undefined}
                aria-describedby={
                  form.formState.errors.proxyUsername ? "proxyUsername-error" : undefined
                }
                {...form.register("proxyUsername")}
              />
              {form.formState.errors.proxyUsername ? (
                <p id="proxyUsername-error" className="text-xs text-destructive">
                  {form.formState.errors.proxyUsername.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="proxyPassword">{t("proxyPassword")}</Label>
              <RevealableInput
                id="proxyPassword"
                autoComplete="off"
                className="font-mono"
                showLabel={t("showPassword")}
                hideLabel={t("hidePassword")}
                aria-invalid={form.formState.errors.proxyPassword ? true : undefined}
                aria-describedby={
                  form.formState.errors.proxyPassword ? "proxyPassword-error" : "proxyPassword-hint"
                }
                {...form.register("proxyPassword")}
                extraTrailingActions={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onRegeneratePassword}
                    aria-label={t("regenerateProxyPassword")}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                }
              />
              {form.formState.errors.proxyPassword ? (
                <p id="proxyPassword-error" className="text-xs text-destructive">
                  {form.formState.errors.proxyPassword.message}
                </p>
              ) : (
                <p id="proxyPassword-hint" className="text-xs text-muted-foreground">
                  {t("proxyPasswordHint")}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {prowlarrConnected ? t("nextStep") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
