"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrIcon, type ArrIconType } from "@/components/ui/arr-icon";
import { syncStatusVariant } from "@/app/(admin)/_lib/status-variant";
import type { SyncRun } from "@/app/(admin)/_lib/sync-types";

interface RecentRunsCardProps {
  runs: SyncRun[] | undefined;
  loading: boolean;
  lastRun: SyncRun | null;
  locale: string;
}

export function RecentRunsCard({ runs, loading, lastRun, locale }: RecentRunsCardProps) {
  const t = useTranslations("dashboard");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b">
        <div className="space-y-1">
          <CardTitle className="text-base">{t("recentRuns")}</CardTitle>
          <CardDescription>
            {lastRun
              ? t("lastSyncFor", {
                  name: lastRun.arrInstance?.name ?? t("unknownInstance"),
                  when: lastRun.finishedAt
                    ? new Date(lastRun.finishedAt).toLocaleString(locale)
                    : t("syncRunning"),
                })
              : t("noRunsHint")}
          </CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/sync-runs">
            {t("openSyncRuns")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-6">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !runs || runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRunsHint")}</p>
        ) : (
          <ul className="divide-y">
            {runs.slice(0, 5).map((r) => (
              <RecentRunRow key={r.id} run={r} locale={locale} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentRunRow({ run, locale }: { run: SyncRun; locale: string }) {
  const duration =
    run.finishedAt && run.startedAt
      ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
      : null;

  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      {run.arrInstance ? (
        <ArrIcon type={run.arrInstance.type as ArrIconType} size={20} />
      ) : (
        <span className="h-5 w-5 shrink-0 rounded-full bg-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="truncate font-medium">{run.arrInstance?.name ?? "—"}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
          <span className="tabular-nums">pcjones {run.pcjonesItemsCount}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">TVDB {run.tvdbItemsCount}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">TMDB {run.tmdbItemsCount}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {duration === null ? "—" : `${(duration / 1000).toFixed(1)}s`}
          </span>
        </span>
        <span className="hidden text-muted-foreground tabular-nums sm:inline">
          pcjones {run.pcjonesItemsCount}
        </span>
        <span className="hidden text-muted-foreground tabular-nums sm:inline">
          TVDB {run.tvdbItemsCount}
        </span>
        <span className="hidden text-muted-foreground tabular-nums sm:inline">
          TMDB {run.tmdbItemsCount}
        </span>
        <span className="hidden text-muted-foreground tabular-nums sm:inline">
          {duration === null ? "—" : `${(duration / 1000).toFixed(1)}s`}
        </span>
        <span className="hidden text-xs whitespace-nowrap text-muted-foreground md:inline">
          {new Date(run.startedAt).toLocaleString(locale)}
        </span>
      </div>
      <Badge variant={syncStatusVariant(run.status)} className="shrink-0 capitalize">
        {run.status}
      </Badge>
    </li>
  );
}
