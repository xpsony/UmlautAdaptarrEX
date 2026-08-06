"use client";

import type { FormEventHandler } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { ArrowRight, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint } from "@/components/ui/field-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RevealableInput } from "@/components/ui/revealable-input";
import type { AdminFormInput, TmdbTestResult, TvdbTestResult } from "../_lib/setup-wizard";

interface AdminStepProps {
  form: UseFormReturn<AdminFormInput>;
  tmdbTesting: boolean;
  tmdbTestResult: TmdbTestResult | null;
  tvdbTesting: boolean;
  tvdbTestResult: TvdbTestResult | null;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onTmdbTest: () => void;
  onTvdbTest: () => void;
}

export function AdminStep({
  form,
  tmdbTesting,
  tmdbTestResult,
  tvdbTesting,
  tvdbTestResult,
  onSubmit,
  onTmdbTest,
  onTvdbTest,
}: AdminStepProps) {
  const t = useTranslations("setup");

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("step1Title")}</CardTitle>
          <CardDescription>{t("step1Hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">{t("username")}</Label>
            <Input
              id="username"
              autoComplete="username"
              autoFocus
              aria-invalid={form.formState.errors.username ? true : undefined}
              {...form.register("username")}
            />
            {form.formState.errors.username ? (
              <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <RevealableInput
              id="password"
              autoComplete="new-password"
              showLabel={t("showPassword")}
              hideLabel={t("hidePassword")}
              aria-invalid={form.formState.errors.password ? true : undefined}
              {...form.register("password")}
            />
            {form.formState.errors.password ? (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tmdbApiKey">{t("tmdbApiKey")}</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <RevealableInput
                  id="tmdbApiKey"
                  autoComplete="off"
                  showLabel={t("showPassword")}
                  hideLabel={t("hidePassword")}
                  {...form.register("tmdbApiKey")}
                />
              </div>
              <Button type="button" variant="outline" onClick={onTmdbTest} disabled={tmdbTesting}>
                {tmdbTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {t("tmdbTest")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("tmdbApiKeyHint")}{" "}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("tmdbApiKeyLink")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            {tmdbTestResult?.ok === true ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t("tmdbTestOk", { title: tmdbTestResult.sample.title })}
              </p>
            ) : tmdbTestResult?.ok === false ? (
              <p className="text-xs text-destructive">
                {t(`tmdbTestErr.${tmdbTestResult.code}`)}
                {tmdbTestResult.detail ? ` ${tmdbTestResult.detail}` : ""}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tvdbApiKey">{t("tvdbApiKey")}</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <RevealableInput
                  id="tvdbApiKey"
                  autoComplete="off"
                  showLabel={t("showPassword")}
                  hideLabel={t("hidePassword")}
                  {...form.register("tvdbApiKey")}
                />
              </div>
              <Button type="button" variant="outline" onClick={onTvdbTest} disabled={tvdbTesting}>
                {tvdbTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {t("tvdbTest")}
              </Button>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="tvdbPin" className="text-xs text-muted-foreground">
                  {t("tvdbPin")}
                </Label>
                <FieldHint text={t("tvdbPinHint")} />
              </div>
              <Input
                id="tvdbPin"
                autoComplete="off"
                placeholder={t("tvdbPinPlaceholder")}
                {...form.register("tvdbPin")}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("tvdbApiKeyHint")}{" "}
              <a
                href="https://thetvdb.com/api-information"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("tvdbApiKeyLink")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            {tvdbTestResult?.ok === true ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t("tvdbTestOk", { title: tvdbTestResult.sample.title })}
              </p>
            ) : tvdbTestResult?.ok === false ? (
              <p className="text-xs text-destructive">
                {t(`tvdbTestErr.${tvdbTestResult.code}`)}
                {tvdbTestResult.detail ? ` ${tvdbTestResult.detail}` : ""}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit">
          {t("nextStep")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
