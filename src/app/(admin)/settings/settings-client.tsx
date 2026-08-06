"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { type SettingsUpdate, SettingsUpdateSchema } from "@/schemas/settings";
import { apiFetch } from "@/app/_lib/api-client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdvancedTab } from "./_components/advanced-tab";
import { GeneralTab } from "./_components/general-tab";
import { PluginsSection } from "./_components/plugins-section";
import { ProvidersTab } from "./_components/providers-tab";
import { ProwlarrSection } from "./_components/prowlarr-section";
import type { SettingsFormInput, SettingsRow } from "./_lib/settings-types";

export function SettingsClient() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const qc = useQueryClient();

  const settings = useQuery<SettingsRow>({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsRow>("/api/admin/settings"),
  });

  const form = useForm<SettingsFormInput, unknown, SettingsUpdate>({
    resolver: zodResolver(SettingsUpdateSchema),
  });

  // State transitions this effect must handle without clobbering user input:
  // - Fresh load: settings.data arrives once, form is untouched (not dirty) -> reset populates it.
  // - Edit -> locale switch: router.refresh() (from the locale toggle) re-runs the
  //   server prefetch, which hands the query client a fresh (but referentially new)
  //   ["settings"] object via HydrationBoundary. The form is dirty, so the guard
  //   below skips the reset and the in-progress edit survives.
  // - Edit -> save: handled by saveMut.onSuccess below, not here.
  // - Background refetch while clean: settings.data changes (e.g. server-normalized
  //   values), form is not dirty, so the reset re-syncs the form to the latest data.
  useEffect(() => {
    if (settings.data && !form.formState.isDirty) form.reset(settings.data);
  }, [settings.data, form]);

  const saveMut = useMutation({
    mutationFn: (data: SettingsUpdate) =>
      apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success(t("saved"));
      // Mark the just-saved values as the new clean baseline immediately: the
      // dirty-guard above means a subsequent refetch can no longer reset the
      // form, so without this the form would stay dirty forever after a save.
      form.reset(form.getValues());
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error(tCommon("error")),
  });

  const onSave = (data: SettingsUpdate) => {
    const payload = { ...data };
    if (settings.data?.proxyPortEnvManaged) {
      delete payload.proxyPort;
    }
    saveMut.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {settings.isLoadingError ? (
        // A failed settings fetch must not render an empty form silently.
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border p-10 text-center text-sm text-destructive"
        >
          <span>{tCommon("error")}</span>
          <Button
            variant="outline"
            disabled={settings.isFetching}
            onClick={() => void settings.refetch()}
          >
            {tBoundaries("retry")}
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="general" className="space-y-4">
          <TabsList>
            <TabsTrigger value="general">{t("section.general")}</TabsTrigger>
            <TabsTrigger value="providers">{t("section.providers")}</TabsTrigger>
            <TabsTrigger value="prowlarr">{t("section.prowlarr")}</TabsTrigger>
            <TabsTrigger value="plugins">{t("section.plugins")}</TabsTrigger>
            <TabsTrigger value="advanced">{t("section.advanced")}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <GeneralTab
              data={settings.data}
              loading={settings.isLoading}
              form={form}
              onSave={onSave}
              saving={saveMut.isPending}
            />
          </TabsContent>

          <TabsContent value="providers" className="space-y-6">
            <ProvidersTab
              form={form}
              data={settings.data}
              onSave={onSave}
              saving={saveMut.isPending}
            />
          </TabsContent>

          <TabsContent value="prowlarr" className="space-y-6">
            <ProwlarrSection />
          </TabsContent>

          <TabsContent value="plugins" className="space-y-6">
            <PluginsSection />
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <AdvancedTab
              form={form}
              data={settings.data}
              onSave={onSave}
              saving={saveMut.isPending}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
