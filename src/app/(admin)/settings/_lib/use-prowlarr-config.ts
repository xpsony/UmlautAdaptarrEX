"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { type ProwlarrCredsInput, ProwlarrCredsSchema } from "@/schemas/prowlarr";
import { ApiError, apiFetch } from "@/app/_lib/api-client";
import type { ProwlarrConfigResponse } from "./settings-types";
import { describeError } from "@/lib/error-format";

interface TestResult {
  ok: boolean;
  message: string;
}

// Encapsulates the Prowlarr "connect / test / disconnect" flow used in the
// settings tab. Exposes the form, the three mutations, and the inline
// test-result so the section component stays render-only.
export function useProwlarrConfig() {
  const t = useTranslations("settings.prowlarr");
  const tCommon = useTranslations("common");
  const qc = useQueryClient();

  const config = useQuery<ProwlarrConfigResponse>({
    queryKey: ["prowlarr-config"],
    queryFn: () => apiFetch<ProwlarrConfigResponse>("/api/admin/instances/prowlarr/config"),
  });

  const form = useForm<ProwlarrCredsInput>({
    resolver: zodResolver(ProwlarrCredsSchema),
    defaultValues: { host: "", apiKey: "" },
  });
  const { reset, getValues, control, formState } = form;

  useEffect(() => {
    if (config.data) {
      reset({ host: config.data.host ?? "", apiKey: "" });
    }
  }, [config.data, reset]);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  // Tracks an explicit user intent ("I clicked Replace") so the section can
  // switch back to the host/apiKey inputs even while a config is stored.
  // Default false. Reset to false on save/disconnect/cancel. Combined with
  // `isConfigured` below into the derived `editing` flag — avoids syncing
  // editing state from a useEffect, which lint flags as cascading renders.
  const [userEditing, setUserEditing] = useState(false);

  const saveMut = useMutation({
    mutationFn: (data: ProwlarrCredsInput) =>
      apiFetch<{ ok: true; configured: boolean; appsCount: number }>(
        "/api/admin/instances/prowlarr/config",
        { method: "PUT", body: JSON.stringify(data) },
      ),
    onSuccess: (res) => {
      toast.success(t("saved", { count: res.appsCount }));
      void qc.invalidateQueries({ queryKey: ["prowlarr-config"] });
      reset({ host: getValues("host"), apiKey: "" });
      setTestResult(null);
      // Drop the user-edit override: the refetched config flips
      // isConfigured to true, so `editing` falls back to false (badge).
      setUserEditing(false);
    },
    onError: (err: unknown) => {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) {
        toast.error(t("authFailed"));
        return;
      }
      const msg = describeError(err);
      toast.error(t("saveFailed", { error: msg }));
    },
  });

  const disconnectMut = useMutation({
    mutationFn: () => apiFetch("/api/admin/instances/prowlarr/config", { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("disconnected"));
      void qc.invalidateQueries({ queryKey: ["prowlarr-config"] });
      reset({ host: "", apiKey: "" });
      setTestResult(null);
      // After disconnect isConfigured turns false, so `editing` derives to
      // true automatically; no need to set userEditing.
      setUserEditing(false);
    },
    onError: () => toast.error(tCommon("error")),
  });

  // `values === null` triggers the server-side fallback to the stored
  // credentials (useStored:true), which lets the operator hit "Test" from
  // the stored-state badge without first clicking Replace and re-typing.
  async function test(values: ProwlarrCredsInput | null): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const body = values ? values : { useStored: true };
      const res = await apiFetch<{
        ok: boolean;
        appsCount?: number;
        error?: string;
        status?: number;
      }>("/api/admin/instances/prowlarr/test", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setTestResult({
          ok: true,
          message: t("testOk", { count: res.appsCount ?? 0 }),
        });
      } else {
        setTestResult({
          ok: false,
          message: res.status === 401 ? t("authFailed") : (res.error ?? "unknown"),
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: describeError(err),
      });
    } finally {
      setTesting(false);
    }
  }

  const isConfigured = !!config.data?.configured;
  const hostValue = useWatch({ control, name: "host" }) ?? "";
  const apiKeyValue = useWatch({ control, name: "apiKey" }) ?? "";

  // Mirror the Provider tab's secret UX: while a key is stored, we render a
  // "Connected" badge + Replace button instead of an empty input that hides
  // the stored credential. The flag is derived rather than synced from an
  // effect: unconfigured installs are always in edit mode, configured ones
  // need the user to click Replace.
  const editing = !isConfigured || userEditing;

  const beginEdit = (): void => {
    setUserEditing(true);
    setTestResult(null);
  };
  const cancelEdit = (): void => {
    reset({ host: config.data?.host ?? "", apiKey: "" });
    setUserEditing(false);
    setTestResult(null);
  };

  const canSubmit =
    editing &&
    !formState.isSubmitting &&
    !saveMut.isPending &&
    hostValue.trim().length > 0 &&
    apiKeyValue.trim().length >= 8;

  return {
    config,
    form,
    isConfigured,
    editing,
    beginEdit,
    cancelEdit,
    hostValue,
    canSubmit,
    testing,
    testResult,
    test,
    saveMut,
    disconnectMut,
  };
}
