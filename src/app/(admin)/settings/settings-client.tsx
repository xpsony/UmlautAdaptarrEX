"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { type SettingsUpdate, SettingsUpdateSchema } from "@/schemas/settings";
import { apiFetch } from "@/app/_lib/api-client";
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
  const qc = useQueryClient();

  const settings = useQuery<SettingsRow>({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsRow>("/api/admin/settings"),
  });

  const form = useForm<SettingsFormInput, unknown, SettingsUpdate>({
    resolver: zodResolver(SettingsUpdateSchema),
  });

  useEffect(() => {
    if (settings.data) form.reset(settings.data);
  }, [settings.data, form]);

  const saveMut = useMutation({
    mutationFn: (data: SettingsUpdate) =>
      apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success(t("saved"));
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error(tCommon("error")),
  });

  const onSave = (data: SettingsUpdate) => saveMut.mutate(data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

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
    </div>
  );
}
