"use client";

import { useTranslations } from "next-intl";
import { Controller } from "react-hook-form";
import { Settings as SettingsIcon } from "lucide-react";
import type { SettingsUpdate } from "@/schemas/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint } from "@/components/ui/field-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SaveBar } from "./save-bar";
import { TitleCacheSection } from "./title-cache-section";
import type { SettingsForm, SettingsRow } from "../_lib/settings-types";

interface AdvancedTabProps {
  form: SettingsForm;
  data: SettingsRow | undefined;
  onSave: (data: SettingsUpdate) => void;
  saving: boolean;
}

export function AdvancedTab({ form, data, onSave, saving }: AdvancedTabProps) {
  const t = useTranslations("settings");
  const proxyPortEnvManaged = data?.proxyPortEnvManaged === true;
  return (
    <div className="space-y-6">
      <form id="advanced-form" onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SettingsIcon className="h-4 w-4" />
              {t("section.advanced")}
            </CardTitle>
            <CardDescription>{t("section.advancedHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="legacyApiPort">{t("legacyApiPort")}</Label>
                  <FieldHint text={t("legacyApiPortHint")} />
                </div>
                <Input
                  id="legacyApiPort"
                  type="number"
                  value={data?.legacyApiPort ?? 5005}
                  readOnly
                  disabled
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="webUiPort">{t("webUiPort")}</Label>
                  <FieldHint text={t("webUiPortHint")} />
                </div>
                <Input
                  id="webUiPort"
                  type="number"
                  value={data?.webUiPort ?? 5007}
                  readOnly
                  disabled
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="proxyPort">{t("proxyPort")}</Label>
                  <FieldHint text={t("proxyPortHint")} />
                </div>
                <Input
                  id="proxyPort"
                  type="number"
                  {...form.register("proxyPort", {
                    valueAsNumber: true,
                    disabled: proxyPortEnvManaged,
                  })}
                />
                {proxyPortEnvManaged ? (
                  <p className="text-xs text-muted-foreground">{t("proxyPortEnvManagedHint")}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cacheDurationMinutes">{t("cacheDurationMinutes")}</Label>
                <Input
                  id="cacheDurationMinutes"
                  type="number"
                  {...form.register("cacheDurationMinutes", {
                    valueAsNumber: true,
                  })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="logRetentionDays">{t("logRetentionDays")}</Label>
                  <FieldHint text={t("logRetentionDaysHint")} />
                </div>
                <Input
                  id="logRetentionDays"
                  type="number"
                  min={1}
                  max={30}
                  {...form.register("logRetentionDays", {
                    valueAsNumber: true,
                  })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="indexerTimeoutSeconds">{t("indexerTimeoutSeconds")}</Label>
                  <FieldHint text={t("indexerTimeoutSecondsHint")} />
                </div>
                <Input
                  id="indexerTimeoutSeconds"
                  type="number"
                  min={5}
                  max={600}
                  {...form.register("indexerTimeoutSeconds", {
                    valueAsNumber: true,
                  })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="indexerRateLimitMs">{t("indexerRateLimitMs")}</Label>
                  <FieldHint text={t("indexerRateLimitMsHint")} />
                </div>
                <Controller
                  control={form.control}
                  name="indexerRateLimitMs"
                  render={({ field }) => {
                    const current = Number(field.value ?? 0);
                    return (
                      <div className="space-y-2">
                        <Slider
                          id="indexerRateLimitMs"
                          min={0}
                          max={60000}
                          step={50}
                          value={[current]}
                          onValueChange={(v) => field.onChange(v[0])}
                          aria-label={t("indexerRateLimitMs")}
                        />
                        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                          <span>0 ms</span>
                          <span className="font-medium text-foreground">{current} ms</span>
                          <span>60000 ms</span>
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="userAgent">{t("userAgent")}</Label>
              <Input id="userAgent" {...form.register("userAgent")} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="blockPrivateInstanceHosts" className="text-sm font-medium">
                  {t("blockPrivateInstanceHosts")}
                </Label>
                <FieldHint text={t("blockPrivateInstanceHostsHint")} />
              </div>
              <Controller
                control={form.control}
                name="blockPrivateInstanceHosts"
                render={({ field }) => (
                  <Switch
                    id="blockPrivateInstanceHosts"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                    aria-label={t("blockPrivateInstanceHosts")}
                  />
                )}
              />
            </div>
          </CardContent>
        </Card>

        <SaveBar form="advanced-form" pending={saving} dirty={form.formState.isDirty} />
      </form>

      <TitleCacheSection />
    </div>
  );
}
