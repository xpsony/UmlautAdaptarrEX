"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { apiFetch } from "@/app/_lib/api-client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdvancedTab } from "./_components/advanced-tab";
import { GeneralTab } from "./_components/general-tab";
import { PluginsSection } from "./_components/plugins-section";
import { ProvidersTab } from "./_components/providers-tab";
import { ProwlarrSection } from "./_components/prowlarr-section";
import { RenamingTab } from "./_components/renaming-tab";
import {
  AdvancedSettingsSchema,
  GeneralSettingsSchema,
  ProvidersSettingsSchema,
  RenamingSettingsSchema,
} from "./_lib/settings-types";
import type {
  AdvancedFormInput,
  AdvancedFormOutput,
  GeneralFormInput,
  GeneralFormOutput,
  ProvidersFormInput,
  ProvidersFormOutput,
  RenamingFormInput,
  RenamingFormOutput,
  SettingsRow,
} from "./_lib/settings-types";

export function SettingsClient() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tBoundaries = useTranslations("boundaries");
  const qc = useQueryClient();

  const settings = useQuery<SettingsRow>({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsRow>("/api/admin/settings"),
  });

  // Four independent RHF instances, one per tab (Epic 6 Task 7). This
  // replaces a single form that shared one dirty flag across all tabs - the
  // Epic-8 bug where editing the Providers tab kept the General tab's Save
  // button enabled too. Each form is scoped to its own field subset via
  // `SettingsUpdateSchema.pick(...)` (see settings-types.ts) and PUTs only
  // those fields, which the partial-update-friendly `SettingsUpdateSchema`
  // (already `SettingsSchema.partial()`) and `putSettings` already support
  // unmodified.
  //
  // The dirty-guarded reset effect + onSuccess-reset pattern from Epic 8 is
  // replicated per form below:
  // - Fresh load / background refetch while clean: settings.data changes,
  //   the form isn't dirty, so the effect resets it to the latest data.
  // - In-progress edit + unrelated refetch (e.g. locale switch): the form is
  //   dirty, so the effect skips the reset and the edit survives.
  // - Save: the mutation's onSuccess resets the form to its own just-saved
  //   values immediately, so it doesn't stay dirty forever waiting for the
  //   background refetch that the dirty-guard above would otherwise block.

  // --- General tab (proxy auth) --------------------------------------------
  const generalForm = useForm<GeneralFormInput, unknown, GeneralFormOutput>({
    resolver: zodResolver(GeneralSettingsSchema),
  });
  useEffect(() => {
    if (settings.data && !generalForm.formState.isDirty) generalForm.reset(settings.data);
  }, [settings.data, generalForm]);
  const generalSaveMut = useMutation({
    mutationFn: (data: GeneralFormOutput) =>
      apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success(t("saved"));
      generalForm.reset(generalForm.getValues());
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error(tCommon("error")),
  });
  const onSaveGeneral = (data: GeneralFormOutput) => generalSaveMut.mutate(data);

  // --- Providers tab ---------------------------------------------------------
  const providersForm = useForm<ProvidersFormInput, unknown, ProvidersFormOutput>({
    resolver: zodResolver(ProvidersSettingsSchema),
  });
  useEffect(() => {
    if (settings.data && !providersForm.formState.isDirty) providersForm.reset(settings.data);
  }, [settings.data, providersForm]);
  const providersSaveMut = useMutation({
    mutationFn: (data: ProvidersFormOutput) =>
      apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success(t("saved"));
      providersForm.reset(providersForm.getValues());
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error(tCommon("error")),
  });
  const onSaveProviders = (data: ProvidersFormOutput) => providersSaveMut.mutate(data);

  // --- Renaming tab ----------------------------------------------------------
  const renamingForm = useForm<RenamingFormInput, unknown, RenamingFormOutput>({
    resolver: zodResolver(RenamingSettingsSchema),
  });
  useEffect(() => {
    if (settings.data && !renamingForm.formState.isDirty) renamingForm.reset(settings.data);
  }, [settings.data, renamingForm]);
  const renamingSaveMut = useMutation({
    mutationFn: (data: RenamingFormOutput) =>
      apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success(t("saved"));
      renamingForm.reset(renamingForm.getValues());
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error(tCommon("error")),
  });
  const onSaveRenaming = (data: RenamingFormOutput) => renamingSaveMut.mutate(data);

  // --- Advanced tab -----------------------------------------------------------
  const advancedForm = useForm<AdvancedFormInput, unknown, AdvancedFormOutput>({
    resolver: zodResolver(AdvancedSettingsSchema),
  });
  useEffect(() => {
    if (settings.data && !advancedForm.formState.isDirty) advancedForm.reset(settings.data);
  }, [settings.data, advancedForm]);
  const advancedSaveMut = useMutation({
    mutationFn: (data: AdvancedFormOutput) =>
      apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success(t("saved"));
      advancedForm.reset(advancedForm.getValues());
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error(tCommon("error")),
  });
  const onSaveAdvanced = (data: AdvancedFormOutput) => {
    const payload = { ...data };
    // The proxy port is pinned by UMLAUTADAPTARREX_PROXY_PORT when set; the
    // field is disabled in the UI (see advanced-tab.tsx) but a stale value
    // could still be part of `data` (e.g. programmatic reset), so drop it
    // here too rather than rely solely on the disabled input.
    if (settings.data?.proxyPortEnvManaged) {
      delete payload.proxyPort;
    }
    advancedSaveMut.mutate(payload);
  };

  // beforeunload guard: fires when ANY of the four per-tab forms is dirty.
  // Reading `formState.isDirty` at render time subscribes this component to
  // that field on each form (RHF's proxy-based formState), so `anyDirty`
  // recomputes and the effect below re-runs whenever any one of the four
  // flips dirty/clean.
  //
  // We deliberately do NOT intercept in-app navigation (clicking a sidebar
  // link, browser back/forward within the app): Next.js App Router has no
  // stable, cancelable router-transition event to hook a confirm dialog
  // into. `beforeunload` only covers the tab/window-close and hard-navigation
  // case, which is the one irrecoverable data-loss scenario - that's a
  // deliberate scope limit, not an oversight.
  const anyDirty =
    generalForm.formState.isDirty ||
    providersForm.formState.isDirty ||
    renamingForm.formState.isDirty ||
    advancedForm.formState.isDirty;
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

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
            <TabsTrigger value="renaming">{t("section.renaming")}</TabsTrigger>
            <TabsTrigger value="advanced">{t("section.advanced")}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <GeneralTab
              data={settings.data}
              loading={settings.isLoading}
              form={generalForm}
              onSave={onSaveGeneral}
              saving={generalSaveMut.isPending}
            />
          </TabsContent>

          <TabsContent value="providers" className="space-y-6">
            <ProvidersTab
              form={providersForm}
              data={settings.data}
              onSave={onSaveProviders}
              saving={providersSaveMut.isPending}
            />
          </TabsContent>

          <TabsContent value="prowlarr" className="space-y-6">
            <ProwlarrSection />
          </TabsContent>

          <TabsContent value="plugins" className="space-y-6">
            <PluginsSection />
          </TabsContent>

          <TabsContent value="renaming" className="space-y-6">
            <RenamingTab
              form={renamingForm}
              onSave={onSaveRenaming}
              saving={renamingSaveMut.isPending}
            />
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <AdvancedTab
              form={advancedForm}
              data={settings.data}
              onSave={onSaveAdvanced}
              saving={advancedSaveMut.isPending}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
