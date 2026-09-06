"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useSyncTracker } from "./_lib/use-sync-tracker";

// recharts is ~120 KB gzipped - load it after First Contentful Paint so the
// KPI cards above the fold render without waiting on the chart library.
// ssr: false prevents SSR rendering, which recharts doesn't support reliably
// anyway (depends on layout measurements).
const RequestsChartInner = dynamic(
  () => import("./dashboard-charts").then((m) => m.RequestsChartInner),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);
const RenamesChartInner = dynamic(
  () => import("./dashboard-charts").then((m) => m.RenamesChartInner),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);
import { apiFetch } from "@/app/_lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProwlarrImportDialog } from "@/components/instances/prowlarr-import-dialog";
import { ProwlarrInstallProxyDialog } from "@/components/instances/prowlarr-install-proxy-dialog";
import { DashboardActionsMenu } from "./_components/dashboard-actions-menu";
import { InstancesOverviewCard } from "./_components/instances-overview-card";
import { KpiCard } from "./_components/kpi-card";
import { RecentRunsCard } from "./_components/recent-runs-card";
import { SyncBackgroundProgress } from "./_components/sync-background-progress";
import { SyncConfirmDialog } from "./_components/sync-confirm-dialog";
import type { Instance, ProwlarrConfig, StatsResponse } from "./_lib/dashboard-types";
import type { SyncRun } from "@/app/(admin)/_lib/sync-types";

export function DashboardClient() {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  // "boundaries" namespace owns the generic retry label (error-boundary copy);
  // reused here so the dashboard error affordance stays translated.
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [installProxyOpen, setInstallProxyOpen] = useState(false);

  const instances = useQuery<Instance[]>({
    queryKey: ["instances"],
    queryFn: () => apiFetch<Instance[]>("/api/admin/instances"),
  });
  const runs = useQuery<{ items: SyncRun[]; total: number }>({
    queryKey: ["sync-runs"],
    queryFn: () => apiFetch("/api/admin/sync-runs?take=8"),
    refetchInterval: 5000,
  });
  const recentRuns = runs.data?.items;
  const stats = useQuery<StatsResponse>({
    queryKey: ["dashboard-stats"],
    queryFn: () => apiFetch<StatsResponse>("/api/admin/stats"),
    refetchInterval: 30_000,
  });
  const prowlarrConfig = useQuery<ProwlarrConfig>({
    queryKey: ["prowlarr-config"],
    queryFn: () => apiFetch<ProwlarrConfig>("/api/admin/instances/prowlarr/config"),
  });

  const sync = useSyncTracker({
    onCompleted: () => {
      void runs.refetch();
      void instances.refetch();
      void stats.refetch();
      setConfirmOpen(false);
    },
  });

  const enabledInstances = instances.data?.filter((i) => i.enabled) ?? [];
  const lastRun = recentRuns?.[0] ?? null;
  const summary = stats.data?.summary;
  const isProwlarrConfigured = !!prowlarrConfig.data?.configured;

  // Surface a failed core fetch explicitly; otherwise an error reads as
  // "no data" (zeroed KPIs / empty cards) and hides the real problem.
  const hasError = instances.isError || stats.isError || runs.isError;

  async function startSync(): Promise<void> {
    await sync.start();
    void runs.refetch();
  }

  return (
    <div className="space-y-6">
      {/* Header + Quick Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            sync={sync}
            enabledInstancesCount={enabledInstances.length}
            onStart={startSync}
          />
          <DashboardActionsMenu
            isProwlarrConfigured={isProwlarrConfigured}
            onOpenImport={() => setImportOpen(true)}
            onOpenInstallProxy={() => setInstallProxyOpen(true)}
          />
        </div>
      </div>

      {hasError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <span>{tCommon("error")}</span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => {
              void instances.refetch();
              void stats.refetch();
              void runs.refetch();
            }}
          >
            {tBoundaries("retry")}
          </button>
        </div>
      ) : null}

      {sync.tracking && !confirmOpen ? <SyncBackgroundProgress sync={sync} /> : null}

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          title={t("instancesCount")}
          loading={instances.isLoading}
          value={enabledInstances.length}
          hint={t("instancesHint", { total: instances.data?.length ?? 0 })}
        />
        <KpiCard
          title={t("requests24h")}
          loading={stats.isLoading}
          value={summary?.requests24h ?? 0}
          hint={
            summary
              ? t("cacheHitRate", {
                  rate: Math.round((summary.cacheHitRate ?? 0) * 100),
                })
              : ""
          }
        />
        <KpiCard
          title={t("renames24h")}
          loading={stats.isLoading}
          value={summary?.renames24h ?? 0}
          hint={summary ? t("renames14dHint", { total: summary.renames14d }) : ""}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("charts.requestsTitle")}</CardTitle>
            <CardDescription>{t("charts.requestsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {/* No isLoading conditional here - switching the rendered subtree
                while the dynamic chunk is mid-resolve causes WebKit's
                "insertBefore: object can not be found here" race. The
                dynamic loading fallback covers chunk-load; recharts handles
                an empty data array on its own until the query settles. */}
            <div role="img" aria-label={t("charts.requestsChartAlt")} className="h-full w-full">
              <RequestsChartInner
                data={stats.data?.requestsHourly ?? []}
                labels={{
                  hit: t("charts.cacheHit"),
                  miss: t("charts.cacheMiss"),
                }}
                locale={locale}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("charts.renamesTitle")}</CardTitle>
            <CardDescription>{t("charts.renamesHint")}</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <div role="img" aria-label={t("charts.renamesChartAlt")} className="h-full w-full">
              <RenamesChartInner
                data={stats.data?.renamesDaily ?? []}
                label={t("charts.renames")}
                locale={locale}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <InstancesOverviewCard instances={instances.data} loading={instances.isLoading} />

      <RecentRunsCard
        runs={recentRuns}
        loading={runs.isLoading}
        lastRun={lastRun}
        locale={locale}
      />

      <ProwlarrImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          void instances.refetch();
        }}
      />
      <ProwlarrInstallProxyDialog open={installProxyOpen} onOpenChange={setInstallProxyOpen} />
    </div>
  );
}
