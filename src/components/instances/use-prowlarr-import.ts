"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type ProwlarrParsedApp,
  type ProwlarrPreviewResult,
} from "@/schemas/prowlarr";
import type { ArrInstanceInput, ArrType } from "@/schemas/instance";
import { DEFAULT_PROVIDER_ORDER } from "@/app/(admin)/instances/_lib/instances-types";
import { isMaskedSecret } from "@/lib/secrets";
import { ApiError, apiFetch } from "@/app/_lib/api-client";
import {
  describeError,
  extractErrorCode,
  extractErrorMessageOnly,
} from "@/lib/error-format";
import {
  type AppRowState,
  type EmptyReason,
  type ExistingInstance,
  type ProwlarrConfig,
  type ProwlarrImportStage,
} from "./prowlarr-import-utils";

const PREVIEW_ENDPOINT = "/api/admin/instances/prowlarr/preview";
const TEST_ENDPOINT = "/api/admin/instances/test";
const CONFIG_ENDPOINT = "/api/admin/instances/prowlarr/config";

interface OverwriteState {
  open: boolean;
  overwrites: { type: string; name: string }[];
  selections: ArrInstanceInput[];
}

const emptyOverwrite: OverwriteState = {
  open: false,
  overwrites: [],
  selections: [],
};

export function useProwlarrImport(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onImported?: (result: { created: number; updated: number }) => void,
) {
  const t = useTranslations("instances.prowlarr");
  const router = useRouter();

  const [stage, setStage] = useState<ProwlarrImportStage>("preview");
  const [preview, setPreview] = useState<ProwlarrPreviewResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [config, setConfig] = useState<ProwlarrConfig>({
    host: null,
    configured: false,
  });
  const [rows, setRows] = useState<Map<number, AppRowState>>(new Map());
  const [overwriteConfirm, setOverwriteConfirm] =
    useState<OverwriteState>(emptyOverwrite);
  const [emptyReason, setEmptyReason] = useState<EmptyReason>("none");
  // Guards the pre-submit list fetch so the submit button can't be
  // double-clicked before importMut.isPending flips.
  const [checking, setChecking] = useState(false);

  const previewMut = useMutation({
    mutationFn: () =>
      apiFetch<ProwlarrPreviewResult>(PREVIEW_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ useStored: true }),
      }),
    onSuccess: (result) => {
      setPreview(result);
      setSelectedIds(new Set(result.apps.map((a) => a.prowlarrId)));
      const next = new Map<number, AppRowState>();
      for (const app of result.apps) {
        next.set(app.prowlarrId, {
          apiKey: isMaskedSecret(app.apiKey) ? "" : app.apiKey,
          status: "untested",
        });
      }
      setRows(next);
      setStage("preview");
    },
    onError: (err: unknown) => {
      const status = err instanceof ApiError ? err.status : 0;
      const body = err instanceof ApiError ? err.body : null;
      const code = extractErrorCode(body);

      if (code === "no_stored_creds" || status === 409) {
        setEmptyReason("none");
        setStage("empty");
        return;
      }
      if (status === 401) {
        setEmptyReason("auth");
        setStage("empty");
        return;
      }
      setEmptyReason("fetch");
      setStage("empty");
      const msg = extractErrorMessageOnly(body) ?? describeError(err);
      toast.error(t("fetchFailed", { error: msg }));
    },
  });

  const importMut = useMutation({
    mutationFn: (selections: ArrInstanceInput[]) =>
      apiFetch<{ created: number; updated: number }>(
        "/api/admin/instances/prowlarr/import",
        { method: "POST", body: JSON.stringify({ selections }) },
      ),
    onSuccess: (result) => {
      toast.success(
        t("imported", { created: result.created, updated: result.updated }),
      );
      onImported?.(result);
      setOverwriteConfirm(emptyOverwrite);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast.error(t("importFailed", { error: describeError(err) }));
    },
  });

  // On open: load config, then preview with stored creds.
  useEffect(() => {
    if (!open) return;
    // Guard against the dialog closing before the fetch settles; without this
    // we'd setState on a closed dialog (stale config / spurious stage change).
    let ignore = false;
    apiFetch<ProwlarrConfig>(CONFIG_ENDPOINT)
      .then((c) => {
        if (ignore) return;
        setConfig(c);
        if (c.configured) {
          previewMut.mutate();
        } else {
          setEmptyReason("none");
          setStage("empty");
        }
      })
      .catch(() => {
        if (ignore) return;
        setConfig({ host: null, configured: false });
        setEmptyReason("none");
        setStage("empty");
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      // Microtask: synchronous setState in the effect body would trip
      // react-hooks/set-state-in-effect.
      queueMicrotask(() => {
        setStage("preview");
        setPreview(null);
        setSelectedIds(new Set());
        setRows(new Map());
        setEmptyReason("none");
        setOverwriteConfirm(emptyOverwrite);
      });
    }
  }, [open]);

  const updateRow = (id: number, patch: Partial<AppRowState>) => {
    setRows((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { apiKey: "", status: "untested" };
      next.set(id, { ...cur, ...patch });
      return next;
    });
  };

  const testRow = async (app: ProwlarrParsedApp) => {
    const row = rows.get(app.prowlarrId);
    const apiKey = row?.apiKey ?? "";
    if (apiKey.trim().length < 8) {
      updateRow(app.prowlarrId, {
        status: "fail",
        error: t("apiKeyTooShort"),
      });
      return;
    }
    updateRow(app.prowlarrId, { status: "testing", error: undefined });
    try {
      const res = await apiFetch<{
        ok: boolean;
        version?: string;
        error?: string;
      }>(TEST_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ type: app.type, host: app.host, apiKey }),
      });
      if (res.ok) {
        updateRow(app.prowlarrId, {
          status: "ok",
          version: res.version,
          error: undefined,
        });
      } else {
        updateRow(app.prowlarrId, {
          status: "fail",
          error: res.error ?? "unknown",
        });
      }
    } catch (err) {
      updateRow(app.prowlarrId, { status: "fail", error: describeError(err) });
    }
  };

  const selectedApps: ProwlarrParsedApp[] = useMemo(
    () => preview?.apps.filter((a) => selectedIds.has(a.prowlarrId)) ?? [],
    [preview, selectedIds],
  );

  const buildSelections = (): ArrInstanceInput[] | null => {
    const issues: string[] = [];
    const selections: ArrInstanceInput[] = [];
    for (const app of selectedApps) {
      const row = rows.get(app.prowlarrId);
      const apiKey = row?.apiKey?.trim() ?? "";
      if (apiKey.length < 8 || isMaskedSecret(apiKey)) {
        issues.push(`${app.name}: ${t("rowApiKeyMissing")}`);
        continue;
      }
      selections.push({
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
    if (selections.length === 0) {
      toast.error(t("noValidSelections"));
      return null;
    }
    if (issues.length > 0) {
      toast.warning(t("partialImport", { count: issues.length }), {
        description: issues.slice(0, 5).join("\n"),
      });
    }
    return selections;
  };

  const handleSubmit = async () => {
    if (checking || importMut.isPending) return;
    const selections = buildSelections();
    if (!selections) return;

    setChecking(true);
    try {
      // Look up existing instances to surface an overwrite confirmation.
      let existing: ExistingInstance[] = [];
      try {
        existing = await apiFetch<ExistingInstance[]>("/api/admin/instances");
      } catch {
        /* server upserts anyway, soft fallthrough on list-load failure */
      }
      const existingKeys = new Set(existing.map((i) => `${i.type}:${i.name}`));
      const overwrites = selections
        .filter((s) => existingKeys.has(`${s.type}:${s.name}`))
        .map((s) => ({ type: s.type, name: s.name }));

      if (overwrites.length > 0) {
        setOverwriteConfirm({ open: true, overwrites, selections });
        return;
      }
      importMut.mutate(selections);
    } finally {
      setChecking(false);
    }
  };

  const toggleApp = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    if (selectedIds.size === preview.apps.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(preview.apps.map((a) => a.prowlarrId)));
  };

  const goToSettings = () => {
    onOpenChange(false);
    router.push("/settings");
  };

  const allSelected =
    preview != null &&
    preview.apps.length > 0 &&
    selectedIds.size === preview.apps.length;
  // `checking` covers the pre-submit list fetch; folding it in keeps the
  // submit button disabled (and spinning) across that gap, closing the
  // double-submit window.
  const submitting = importMut.isPending || checking;
  const isLoadingPreview = previewMut.isPending && !preview;

  return {
    stage,
    preview,
    config,
    selectedIds,
    rows,
    emptyReason,
    overwriteConfirm,
    setOverwriteConfirm,
    isLoadingPreview,
    submitting,
    allSelected,
    toggleApp,
    toggleAll,
    updateRow,
    testRow,
    handleSubmit,
    importMut,
    goToSettings,
  };
}
