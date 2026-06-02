"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { type SetupInput } from "@/schemas/auth";
import type {
  ProwlarrIndexerView,
  ProwlarrParsedApp,
  ProwlarrPreviewResult,
  ProwlarrSkippedApp,
} from "@/schemas/prowlarr";
import type { ArrInstanceInput, ArrType } from "@/schemas/instance";
import { DEFAULT_PROVIDER_ORDER } from "@/app/(admin)/instances/_lib/instances-types";
import type { PluginListEntry } from "@/schemas/plugins";
import { isMaskedSecret } from "@/lib/secrets";
import { ApiError, apiFetch } from "@/app/_lib/api-client";
import { describeError } from "@/lib/error-format";
import {
  AdminSchema,
  type AdminFormInput,
  type AppRowState,
  type InstallProxyPreview,
  type OperationMode,
  ProwlarrCredsForm,
  type ProwlarrFormInput,
  ProxySchema,
  type ProxyFormInput,
  type ProwlarrConnectionTestResult,
  type SetupStatus,
  type Step,
  type TmdbTestResult,
  type TvdbTestResult,
  generatePassword,
} from "./setup-wizard";

export function useSetupWizard(initialStatus: SetupStatus) {
  const t = useTranslations("setup");
  const tProw = useTranslations("instances.prowlarr");
  const router = useRouter();

  const [step, setStep] = useState<Step>("admin");

  const [admin, setAdmin] = useState<AdminFormInput | null>(null);
  const [operationMode, setOperationMode] = useState<OperationMode>("proxy");

  const [pluginList, setPluginList] = useState<PluginListEntry[] | null>(null);
  const [pluginEnabled, setPluginEnabled] = useState<Map<string, boolean>>(new Map());

  const [prowlarrConnected, setProwlarrConnected] = useState(false);
  const [prowlarrApps, setProwlarrApps] = useState<ProwlarrParsedApp[]>([]);
  const [prowlarrSkippedApps, setProwlarrSkippedApps] = useState<ProwlarrSkippedApp[]>([]);
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set());
  const [appRows, setAppRows] = useState<Map<number, AppRowState>>(new Map());

  const [proxyValues, setProxyValues] = useState<ProxyFormInput | null>(null);

  const [installPreview, setInstallPreview] = useState<InstallProxyPreview | null>(null);
  const [installHost, setInstallHost] = useState<string>("");

  const [patchIndexers, setPatchIndexers] = useState<ProwlarrIndexerView[]>([]);
  const [patchSelectedIds, setPatchSelectedIds] = useState<Set<number>>(new Set());
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchSubmitting, setPatchSubmitting] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Number of arr instances actually persisted by the final setup submit.
  // Drives whether the optional "run a sync now?" step is offered at the end.
  const [importedInstancesCount, setImportedInstancesCount] = useState(0);
  const [syncSubmitting, setSyncSubmitting] = useState(false);

  const [tmdbTestResult, setTmdbTestResult] = useState<TmdbTestResult | null>(null);
  const [tmdbTesting, setTmdbTesting] = useState(false);

  const [tvdbTestResult, setTvdbTestResult] = useState<TvdbTestResult | null>(null);
  const [tvdbTesting, setTvdbTesting] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [prowlarrTesting, setProwlarrTesting] = useState(false);
  const [prowlarrTestResult, setProwlarrTestResult] = useState<ProwlarrConnectionTestResult | null>(
    null,
  );

  // Forms ------------------------------------------------------------------

  const adminForm = useForm<AdminFormInput>({
    resolver: zodResolver(AdminSchema),
    defaultValues: {
      username: "",
      password: "",
      tmdbApiKey: "",
      tvdbApiKey: "",
      tvdbPin: "",
    },
  });

  const prowlarrForm = useForm<ProwlarrFormInput>({
    resolver: zodResolver(ProwlarrCredsForm),
    defaultValues: {
      host: initialStatus.prowlarrConfig.host ?? "",
      apiKey: "",
    },
  });

  const prowlarrHostValue = useWatch({ control: prowlarrForm.control, name: "host" }) ?? "";

  const initialProxyPassword = useMemo(() => generatePassword(), []);
  const proxyForm = useForm<ProxyFormInput>({
    resolver: zodResolver(ProxySchema),
    defaultValues: {
      proxyUsername: initialStatus.proxyDefaults.username || "UmlautAdaptarr",
      proxyPassword: initialProxyPassword,
    },
  });

  // Admin step -------------------------------------------------------------

  const onAdminSubmit = adminForm.handleSubmit((values) => {
    setAdmin(values);
    setStep("mode");
  });

  // TMDB key test inside the wizard. Uses the public, rate-limited endpoint
  // because the user has no session yet. The result is shown inline next to
  // the input field; it does NOT block the wizard (the key stays optional
  // as long as no non-DE plugins are enabled).
  const onTmdbTest = async () => {
    const key = (adminForm.getValues("tmdbApiKey") ?? "").trim();
    setTmdbTesting(true);
    setTmdbTestResult(null);
    try {
      const r = await apiFetch<TmdbTestResult>("/api/auth/test-tmdb-key", {
        method: "POST",
        body: JSON.stringify({ apiKey: key }),
      });
      setTmdbTestResult(r);
    } catch (err) {
      setTmdbTestResult({
        ok: false,
        code: "unknown",
        detail: describeError(err),
      });
    } finally {
      setTmdbTesting(false);
    }
  };

  // TVDB key test, mirrors onTmdbTest. PIN is forwarded only when filled so
  // the upstream login request stays minimal for non-subscriber accounts.
  const onTvdbTest = async () => {
    const key = (adminForm.getValues("tvdbApiKey") ?? "").trim();
    const pin = (adminForm.getValues("tvdbPin") ?? "").trim();
    setTvdbTesting(true);
    setTvdbTestResult(null);
    try {
      const r = await apiFetch<TvdbTestResult>("/api/auth/test-tvdb-key", {
        method: "POST",
        body: JSON.stringify({ apiKey: key, ...(pin ? { pin } : {}) }),
      });
      setTvdbTestResult(r);
    } catch (err) {
      setTvdbTestResult({
        ok: false,
        code: "unknown",
        detail: describeError(err),
      });
    } finally {
      setTvdbTesting(false);
    }
  };

  // Plugins step -----------------------------------------------------------

  const loadPluginList = async () => {
    if (pluginList) return;
    try {
      const res = await apiFetch<PluginListEntry[]>("/api/auth/plugins");
      setPluginList(res);
      setPluginEnabled(new Map(res.map((p) => [p.id, p.enabled])));
    } catch (err) {
      toast.error(
        t("pluginsLoadFailed", {
          error: describeError(err),
        }),
      );
    }
  };

  const togglePlugin = (id: string) => {
    setPluginEnabled((prev) => {
      const next = new Map(prev);
      const willBeEnabled = !next.get(id);
      const meta = pluginList?.find((p) => p.id === id);
      // Mirror the admin Settings UI: enabling a non-DE plugin requires a
      // TMDB key. The wizard's TMDB key lives in adminForm.tmdbApiKey at
      // this point (not yet persisted), so we read from there.
      if (
        willBeEnabled &&
        meta &&
        meta.language !== "de" &&
        !adminForm.getValues("tmdbApiKey")?.trim()
      ) {
        toast.error(t("pluginsTmdbRequired"));
        return prev;
      }
      next.set(id, willBeEnabled);
      return next;
    });
  };

  // Prowlarr connect -------------------------------------------------------

  const onProwlarrTest = async (): Promise<void> => {
    const valid = await prowlarrForm.trigger();
    if (!valid) return;
    const values = prowlarrForm.getValues();
    setProwlarrTesting(true);
    setProwlarrTestResult(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        appsCount?: number;
        error?: string;
        status?: number;
      }>("/api/auth/prowlarr/test", {
        method: "POST",
        body: JSON.stringify({ host: values.host, apiKey: values.apiKey }),
      });
      if (res.ok) {
        setProwlarrTestResult({
          ok: true,
          message: t("testProwlarrOk", { count: res.appsCount ?? 0 }),
        });
      } else {
        setProwlarrTestResult({
          ok: false,
          message: res.status === 401 ? tProw("authFailed") : (res.error ?? "unknown"),
        });
      }
    } catch (err) {
      setProwlarrTestResult({
        ok: false,
        message: describeError(err),
      });
    } finally {
      setProwlarrTesting(false);
    }
  };

  const onProwlarrSubmit = prowlarrForm.handleSubmit(async (values) => {
    setPreviewLoading(true);
    try {
      const result = await apiFetch<ProwlarrPreviewResult>("/api/auth/prowlarr/preview", {
        method: "POST",
        body: JSON.stringify({ host: values.host, apiKey: values.apiKey }),
      });
      setProwlarrConnected(true);
      setProwlarrApps(result.apps);
      setProwlarrSkippedApps(result.skipped);
      setSelectedAppIds(new Set(result.apps.map((a) => a.prowlarrId)));
      const initial = new Map<number, AppRowState>();
      for (const app of result.apps) {
        initial.set(app.prowlarrId, {
          apiKey: isMaskedSecret(app.apiKey) ? "" : app.apiKey,
          status: "untested",
        });
      }
      setAppRows(initial);
      setStep("prowlarr-import");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) {
        toast.error(tProw("authFailed"));
      } else {
        toast.error(
          tProw("fetchFailed", {
            error: describeError(err),
          }),
        );
      }
    } finally {
      setPreviewLoading(false);
    }
  });

  const skipProwlarr = async () => {
    try {
      if (initialStatus.prowlarrConfig.configured) {
        await apiFetch("/api/auth/prowlarr", { method: "DELETE" });
      }
    } catch {
      /* non-fatal, user just wants to skip */
    }
    setProwlarrConnected(false);
    setProwlarrApps([]);
    setSelectedAppIds(new Set());
    setAppRows(new Map());
    if (operationMode === "legacy") {
      // Legacy mode: no proxy step. We fire finalSubmit directly with the
      // proxy defaults that were already generated (username =
      // "UmlautAdaptarr", password = generatePassword() from the proxyForm
      // useEffect). That way valid credentials still land in the DB if the
      // user later switches to "proxy"/"both".
      const values = proxyForm.getValues();
      setProxyValues(values);
      void finalSubmit({ admin: admin!, proxy: values, install: null });
      return;
    }
    setStep("proxy");
  };

  // Prowlarr import (apps) -------------------------------------------------

  const updateAppRow = (id: number, patch: Partial<AppRowState>) => {
    setAppRows((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { apiKey: "", status: "untested" };
      next.set(id, { ...cur, ...patch });
      return next;
    });
  };

  const testAppRow = async (app: ProwlarrParsedApp) => {
    const row = appRows.get(app.prowlarrId);
    const apiKey = row?.apiKey ?? "";
    if (apiKey.trim().length < 8) {
      updateAppRow(app.prowlarrId, {
        status: "fail",
        error: tProw("apiKeyTooShort"),
      });
      return;
    }
    updateAppRow(app.prowlarrId, { status: "testing", error: undefined });
    try {
      const res = await apiFetch<{
        ok: boolean;
        version?: string;
        error?: string;
      }>("/api/auth/instances/test", {
        method: "POST",
        body: JSON.stringify({ type: app.type, host: app.host, apiKey }),
      });
      if (res.ok) {
        updateAppRow(app.prowlarrId, {
          status: "ok",
          version: res.version,
          error: undefined,
        });
      } else {
        updateAppRow(app.prowlarrId, {
          status: "fail",
          error: res.error ?? "unknown",
        });
      }
    } catch (err) {
      updateAppRow(app.prowlarrId, {
        status: "fail",
        error: describeError(err),
      });
    }
  };

  const toggleApp = (id: number) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildSelections = (): ArrInstanceInput[] | null => {
    const issues: string[] = [];
    const out: ArrInstanceInput[] = [];
    for (const app of prowlarrApps) {
      if (!selectedAppIds.has(app.prowlarrId)) continue;
      const row = appRows.get(app.prowlarrId);
      const apiKey = row?.apiKey?.trim() ?? "";
      if (apiKey.length < 8 || isMaskedSecret(apiKey)) {
        issues.push(`${app.name}: ${tProw("rowApiKeyMissing")}`);
        continue;
      }
      out.push({
        type: app.type as ArrType,
        name: app.name,
        host: app.host,
        apiKey,
        enabled: true,
        providerOrder: DEFAULT_PROVIDER_ORDER[app.type as ArrType] ?? null,
        enableYearMatching: true,
        yearMatchingTolerance: 1,
      });
    }
    if (out.length === 0 && selectedAppIds.size > 0) {
      toast.error(tProw("noValidSelections"));
      return null;
    }
    if (issues.length > 0) {
      toast.warning(tProw("partialImport", { count: issues.length }), {
        description: issues.slice(0, 5).join("\n"),
      });
    }
    return out;
  };

  // Proxy step -------------------------------------------------------------

  const onProxySubmit = proxyForm.handleSubmit(async (values) => {
    setProxyValues(values);
    if (prowlarrConnected) {
      setStep("prowlarr-install");
      void loadInstallPreview();
    } else {
      await finalSubmit({ admin: admin!, proxy: values, install: null });
    }
  });

  // Prowlarr install (push proxy to Prowlarr) ------------------------------

  const loadInstallPreview = async () => {
    try {
      const res = await apiFetch<InstallProxyPreview>("/api/auth/prowlarr/install-proxy/preview");
      setInstallPreview(res);
      setInstallHost(res.defaultHost);
    } catch (err) {
      toast.error(
        tProw("fetchFailed", {
          error: describeError(err),
        }),
      );
    }
  };

  const skipInstallProxy = async () => {
    if (!admin || !proxyValues) return;
    await finalSubmit({ admin, proxy: proxyValues, install: null });
  };

  const submitInstallProxy = async () => {
    if (!admin || !proxyValues) return;
    const host = installHost.trim();
    if (host.length === 0) {
      toast.error(t("installHostRequired"));
      return;
    }
    await finalSubmit({ admin, proxy: proxyValues, install: { host } });
  };

  // Patch-indexers step (runs AFTER finalSubmit, so the proxy + tag exist and
  // the session cookie is set — hence the /api/admin endpoints).
  const loadPatchIndexers = async () => {
    setPatchLoading(true);
    try {
      const res = await apiFetch<{ indexers: ProwlarrIndexerView[] }>(
        "/api/admin/instances/prowlarr/indexers",
      );
      setPatchIndexers(res.indexers);
      // "Select all" default: pre-select every patchable indexer.
      setPatchSelectedIds(new Set(res.indexers.filter((i) => i.patchable).map((i) => i.id)));
    } catch (err) {
      toast.error(tProw("fetchFailed", { error: describeError(err) }));
    } finally {
      setPatchLoading(false);
    }
  };

  const togglePatchIndexer = (id: number) => {
    setPatchSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePatchAll = (checked: boolean) => {
    setPatchSelectedIds(
      checked ? new Set(patchIndexers.filter((i) => i.patchable).map((i) => i.id)) : new Set(),
    );
  };

  const finishAfterPatch = () => {
    if (importedInstancesCount > 0) setStep("sync");
    else router.push("/dashboard");
  };

  const submitPatchIndexers = async () => {
    setPatchSubmitting(true);
    try {
      await apiFetch("/api/admin/instances/prowlarr/indexers/patch", {
        method: "POST",
        body: JSON.stringify({ selectedIds: Array.from(patchSelectedIds) }),
      });
      toast.success(t("patchIndexersDone"));
    } catch (err) {
      toast.error(tProw("fetchFailed", { error: describeError(err) }));
    } finally {
      setPatchSubmitting(false);
      finishAfterPatch();
    }
  };

  const skipPatchIndexers = () => finishAfterPatch();

  // Prowlarr-import "Next" handler when no proxy step follows.
  const advanceFromProwlarrImport = () => {
    if (operationMode === "legacy") {
      const values = proxyForm.getValues();
      setProxyValues(values);
      void finalSubmit({ admin: admin!, proxy: values, install: null });
      return;
    }
    setStep("proxy");
  };

  // Final submit -----------------------------------------------------------

  const finalSubmit = async (args: {
    admin: AdminFormInput;
    proxy: ProxyFormInput;
    install: { host: string } | null;
  }) => {
    setIsSubmitting(true);
    try {
      const selections = prowlarrConnected ? buildSelections() : [];
      if (selections === null) {
        setIsSubmitting(false);
        return;
      }
      const pluginSelection =
        pluginList && pluginEnabled.size > 0
          ? pluginList.map((p) => ({
              id: p.id,
              enabled: pluginEnabled.get(p.id) ?? p.defaultEnabled,
            }))
          : undefined;
      const payload: SetupInput = {
        username: args.admin.username,
        password: args.admin.password,
        tmdbApiKey: args.admin.tmdbApiKey || null,
        tvdbApiKey: args.admin.tvdbApiKey || null,
        tvdbPin: args.admin.tvdbPin || null,
        prowlarrInstances: selections.length > 0 ? selections : undefined,
        proxyUsername: args.proxy.proxyUsername,
        proxyPassword: args.proxy.proxyPassword,
        installProxyInProwlarr: args.install ?? undefined,
        plugins: pluginSelection,
        operationMode,
      };
      const result = await apiFetch<{
        ok: boolean;
        proxyInstall: { ok: boolean; error?: string } | null;
      }>("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (result.proxyInstall && !result.proxyInstall.ok) {
        toast.warning(t("installProxyFailed", { error: result.proxyInstall.error ?? "" }));
      } else if (result.proxyInstall?.ok) {
        toast.success(t("installProxyOk"));
      }
      const importedCount = selections.length;
      setImportedInstancesCount(importedCount);
      setIsSubmitting(false);
      // The proxy/tag now exist and we have a session: offer the indexer
      // patch step before the optional sync step, but only when a proxy was
      // actually installed and Prowlarr is connected.
      if (result.proxyInstall?.ok && prowlarrConnected) {
        setStep("prowlarr-patch-indexers");
        void loadPatchIndexers();
      } else if (importedCount > 0) {
        setStep("sync");
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      toast.error(t("errors.validation"));
      console.error(err);
      setIsSubmitting(false);
    }
  };

  // Sync step --------------------------------------------------------------

  const startSyncAndFinish = async () => {
    setSyncSubmitting(true);
    try {
      await apiFetch<{ ok: boolean; runIds: string[]; instanceCount: number }>("/api/admin/sync", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success(t("syncQueued"));
    } catch (err) {
      toast.error(t("syncStartFailed", { error: describeError(err) }));
    } finally {
      setSyncSubmitting(false);
      router.push("/dashboard");
    }
  };

  const skipSyncAndFinish = () => {
    router.push("/dashboard");
  };

  // Stepper ----------------------------------------------------------------

  const proxyEnabled = operationMode !== "legacy";

  const steps = useMemo(() => {
    const labels: { key: Step; label: string }[] = [
      { key: "admin", label: t("step1Title") },
      { key: "mode", label: t("modeTitle") },
      { key: "plugins", label: t("pluginsTitle") },
      { key: "prowlarr-connect", label: t("step2Title") },
    ];
    if (prowlarrConnected) {
      labels.push({ key: "prowlarr-import", label: t("step3Title") });
    }
    if (proxyEnabled) {
      labels.push({ key: "proxy", label: t("step4Title") });
    }
    if (prowlarrConnected && proxyEnabled) {
      labels.push({ key: "prowlarr-install", label: t("step5Title") });
      labels.push({
        key: "prowlarr-patch-indexers",
        label: t("patchStepTitle"),
      });
    }
    if (importedInstancesCount > 0 || step === "sync") {
      labels.push({ key: "sync", label: t("syncStepTitle") });
    }
    return labels;
  }, [prowlarrConnected, proxyEnabled, importedInstancesCount, step, t]);

  const currentStepIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === step),
  );

  const regenerateProxyPassword = () =>
    proxyForm.setValue("proxyPassword", generatePassword(), {
      shouldDirty: true,
      shouldValidate: true,
    });

  return {
    // step + meta
    step,
    setStep,
    steps,
    currentStepIndex,
    // forms
    adminForm,
    prowlarrForm,
    proxyForm,
    prowlarrHostValue,
    // mode
    operationMode,
    setOperationMode,
    // plugins
    pluginList,
    pluginEnabled,
    loadPluginList,
    togglePlugin,
    // tmdb
    tmdbTesting,
    tmdbTestResult,
    onTmdbTest,
    // tvdb
    tvdbTesting,
    tvdbTestResult,
    onTvdbTest,
    // admin
    onAdminSubmit,
    // prowlarr connect
    prowlarrConnected,
    prowlarrTesting,
    prowlarrTestResult,
    previewLoading,
    onProwlarrTest,
    onProwlarrSubmit,
    skipProwlarr,
    // prowlarr import
    prowlarrApps,
    prowlarrSkippedApps,
    selectedAppIds,
    appRows,
    isSubmitting,
    toggleApp,
    updateAppRow,
    testAppRow,
    advanceFromProwlarrImport,
    // proxy
    onProxySubmit,
    regenerateProxyPassword,
    // prowlarr install
    installPreview,
    installHost,
    setInstallHost,
    proxyValues,
    skipInstallProxy,
    submitInstallProxy,
    // prowlarr patch indexers
    patchIndexers,
    patchSelectedIds,
    patchLoading,
    patchSubmitting,
    togglePatchIndexer,
    togglePatchAll,
    submitPatchIndexers,
    skipPatchIndexers,
    // sync
    importedInstancesCount,
    syncSubmitting,
    startSyncAndFinish,
    skipSyncAndFinish,
  };
}

export type SetupWizard = ReturnType<typeof useSetupWizard>;
