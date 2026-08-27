"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, CloudUpload, Loader2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InstallProxyPreview, ProxyFormInput } from "../_lib/setup-wizard";

interface ProwlarrInstallStepProps {
  installPreview: InstallProxyPreview | null;
  proxyValues: ProxyFormInput | null;
  installHost: string;
  isSubmitting: boolean;
  onHostChange: (host: string) => void;
  onBack: () => void;
  onSkip: () => void;
  onSubmit: () => void;
}

export function ProwlarrInstallStep({
  installPreview,
  proxyValues,
  installHost,
  isSubmitting,
  onHostChange,
  onBack,
  onSkip,
  onSubmit,
}: ProwlarrInstallStepProps) {
  const t = useTranslations("setup");
  const tCommon = useTranslations("common");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("step5Title")}</CardTitle>
          <CardDescription>{t("step5Hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!installPreview ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{tCommon("loading")}</span>
            </div>
          ) : (
            <>
              {installPreview.existing ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{t("installOverwriteWarning")}</span>
                </div>
              ) : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                <dt className="text-muted-foreground">{t("installFieldName")}</dt>
                <dd className="font-mono">{installPreview.name}</dd>
                <dt className="text-muted-foreground">{t("installFieldPort")}</dt>
                <dd className="font-mono">{installPreview.port}</dd>
                <dt className="text-muted-foreground">{t("installFieldUsername")}</dt>
                <dd className="font-mono">
                  {proxyValues?.proxyUsername ?? installPreview.username}
                </dd>
              </dl>
              <div className="space-y-2">
                <Label htmlFor="install-host">{t("installHostLabel")}</Label>
                <Input
                  id="install-host"
                  value={installHost}
                  onChange={(e) => onHostChange(e.target.value)}
                  placeholder={installPreview.defaultHost}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">{t("installHostHint")}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting}>
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onSkip} disabled={isSubmitting}>
            <SkipForward className="h-4 w-4" />
            {t("skipInstallProxy")}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting || !installPreview}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CloudUpload className="h-4 w-4" />
            )}
            {t("installAndFinish")}
          </Button>
        </div>
      </div>
    </div>
  );
}
