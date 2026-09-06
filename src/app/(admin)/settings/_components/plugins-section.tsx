"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, Loader2, Plug, RefreshCw } from "lucide-react";
import { ApiError, apiFetch } from "@/app/_lib/api-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import type { PluginEntry, SettingsRow } from "../_lib/settings-types";

const PLUGINS_RESYNC_FLAG = "plugins:requiresResync";

export function PluginsSection() {
  const t = useTranslations("settings.plugins");
  const tPlugins = useTranslations("plugins");
  const tCommon = useTranslations("common");
  const qc = useQueryClient();
  const requiresResync = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => window.localStorage.getItem(PLUGINS_RESYNC_FLAG) === "1",
    () => false,
  );
  const setRequiresResync = (val: boolean): void => {
    if (val) window.localStorage.setItem(PLUGINS_RESYNC_FLAG, "1");
    else window.localStorage.removeItem(PLUGINS_RESYNC_FLAG);
    window.dispatchEvent(new StorageEvent("storage"));
  };

  const plugins = useQuery<PluginEntry[]>({
    queryKey: ["plugins"],
    queryFn: () => apiFetch<PluginEntry[]>("/api/admin/plugins"),
  });

  const settings = useQuery<SettingsRow>({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsRow>("/api/admin/settings"),
  });
  const hasTmdbKey = !!settings.data?.tmdbApiKey?.trim();
  const nonDePluginsActive = (plugins.data ?? []).filter((p) => p.enabled && p.language !== "de");
  const showTmdbWarning = !hasTmdbKey && nonDePluginsActive.length > 0;

  const toggleMut = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch<{ id: string; enabled: boolean; requiresResync: boolean }>(
        `/api/admin/plugins/${id}`,
        { method: "PATCH", body: JSON.stringify({ enabled }) },
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["plugins"] });
      if (res.requiresResync) setRequiresResync(true);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { error?: string } | null;
        if (body?.error === "tmdb_required") {
          toast.error(t("tmdbKeyRequiredToast"));
          return;
        }
      }
      toast.error(tCommon("error"));
    },
  });

  const syncMut = useMutation({
    mutationFn: () => apiFetch("/api/admin/sync", { method: "POST", body: "{}" }),
    onSuccess: () => {
      setRequiresResync(false);
      toast.success(t("resyncStarted"));
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError && err.status === 409 ? t("resyncConflict") : tCommon("error");
      toast.error(msg);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {requiresResync ? (
          <Alert variant="warning" className="flex-wrap justify-between gap-3">
            <div className="flex items-start gap-2">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
              <AlertDescription>{t("resyncBanner")}</AlertDescription>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
            >
              {syncMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("resyncNow")}
            </Button>
          </Alert>
        ) : null}

        {/* Standing advisory about the per-plugin query cost. Always shown so
            it is visible before a plugin is switched on, not only afterwards. */}
        <Alert role="status">
          <Info className="h-4 w-4" />
          <AlertDescription>{t("costHint")}</AlertDescription>
        </Alert>

        {showTmdbWarning ? (
          // Standing condition (missing TMDB key), not a transient event -
          // role="status" instead of the warning variant's default "alert".
          <Alert variant="warning" role="status">
            <Plug className="h-4 w-4" />
            <AlertDescription>{t("tmdbKeyRequired")}</AlertDescription>
          </Alert>
        ) : null}

        {plugins.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-3">
            {plugins.data?.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-4 rounded-md border p-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      {tPlugins(p.nameKey.replace(/^plugins\./, ""))}
                    </p>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                      {p.language}
                    </span>
                    {p.defaultEnabled ? (
                      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
                        {t("defaultEnabledBadge")}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tPlugins(p.descriptionKey.replace(/^plugins\./, ""))}
                  </p>
                </div>
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(checked) => toggleMut.mutate({ id: p.id, enabled: checked })}
                  disabled={
                    toggleMut.isPending || (!hasTmdbKey && p.language !== "de" && !p.enabled)
                  }
                  aria-label={tPlugins(p.nameKey.replace(/^plugins\./, ""))}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
