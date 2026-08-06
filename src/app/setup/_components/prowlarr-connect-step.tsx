"use client";

import type { FormEventHandler } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Plug,
  SkipForward,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProwlarrConnectionTestResult, ProwlarrFormInput } from "../_lib/setup-wizard";

interface ProwlarrConnectStepProps {
  form: UseFormReturn<ProwlarrFormInput>;
  hostValue: string;
  testResult: ProwlarrConnectionTestResult | null;
  testing: boolean;
  previewLoading: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onBack: () => void;
  onSkip: () => void;
  onTest: () => void;
}

export function ProwlarrConnectStep({
  form,
  hostValue,
  testResult,
  testing,
  previewLoading,
  onSubmit,
  onBack,
  onSkip,
  onTest,
}: ProwlarrConnectStepProps) {
  const t = useTranslations("setup");
  const tProw = useTranslations("instances.prowlarr");

  // Only treat the live field as a link target when it parses as an http(s)
  // URL — otherwise an attacker-influenced value like "javascript:..." could
  // become the anchor href. Falls back to plain text below.
  const settingsHref = ((): string | null => {
    const trimmed = hostValue.replace(/\/+$/, "");
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return `${trimmed}/settings/general`;
    } catch {
      return null;
    }
  })();

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("step2Title")}</CardTitle>
          <CardDescription>{t("step2Hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prowlarr-host">{tProw("host")}</Label>
            <div className="flex items-stretch gap-2">
              <Input
                id="prowlarr-host"
                placeholder={tProw("hostPlaceholder")}
                autoFocus
                className="flex-1"
                {...form.register("host")}
              />
              {settingsHref ? (
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  size="default"
                  title={t("openProwlarrSettings")}
                >
                  <a
                    href={settingsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("openProwlarrSettings")}
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("openProwlarrSettings")}
                  </a>
                </Button>
              ) : hostValue.trim().length > 0 ? (
                // Host typed but not a valid http(s) URL: show the label as
                // inert text rather than a (potentially unsafe) link.
                <span className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
                  <ExternalLink className="h-4 w-4" />
                  {t("openProwlarrSettings")}
                </span>
              ) : null}
            </div>
            {form.formState.errors.host ? (
              <p className="text-xs text-destructive">{form.formState.errors.host.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="prowlarr-apikey">{tProw("apiKey")}</Label>
            <Input
              id="prowlarr-apikey"
              type="password"
              autoComplete="off"
              placeholder={tProw("apiKeyPlaceholder")}
              {...form.register("apiKey")}
            />
            {form.formState.errors.apiKey ? (
              <p className="text-xs text-destructive">{form.formState.errors.apiKey.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{tProw("apiKeyHint")}</p>
            )}
          </div>
          {testResult ? (
            <Alert variant={testResult.ok ? "success" : "destructive"} size="compact">
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription>{testResult.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={onSkip}>
            <SkipForward className="h-4 w-4" />
            {t("skipProwlarr")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={testing || previewLoading}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            {t("testProwlarr")}
          </Button>
          <Button type="submit" disabled={previewLoading || testing}>
            {previewLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("connectProwlarr")}
          </Button>
        </div>
      </div>
    </form>
  );
}
