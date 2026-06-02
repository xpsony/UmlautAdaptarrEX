"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Pause, Play, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { downloadJsonl, formatTimestamp, parseContext } from "./_lib/log-format";
import { useLogStream } from "./_lib/use-log-stream";

const LEVELS = ["all", "info", "warn", "error", "debug"] as const;

export function LogsClient({ apiPort }: { apiPort: number }) {
  const t = useTranslations("logs");
  const stream = useLogStream(apiPort);
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return stream.items.filter((i) => {
      if (level !== "all" && i.level !== level) return false;
      if (!f) return true;
      return i.message.toLowerCase().includes(f) || (i.context ?? "").toLowerCase().includes(f);
    });
  }, [stream.items, filter, level]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="-mx-1 flex flex-wrap items-center gap-2 px-1">
          <Badge
            variant={stream.connected ? "success" : "muted"}
            className="font-mono"
            aria-live="polite"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                stream.connected ? "animate-pulse bg-emerald-500" : "bg-muted-foreground",
              )}
            />
            {stream.connected ? t("live") : t("noConnection")}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => stream.setPaused((p) => !p)}
            aria-label={stream.paused ? t("resume") : t("pause")}
          >
            {stream.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            <span className="hidden sm:inline">{stream.paused ? t("resume") : t("pause")}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadJsonl(filtered)}
            disabled={filtered.length === 0}
            aria-label={t("download")}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t("download")}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={stream.clear} aria-label={t("clear")}>
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">{t("clear")}</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("search")}
              className="pr-9 pl-9"
            />
            {filter ? (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                aria-label={t("clearFilter")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((lvl) => (
                <SelectItem key={lvl} value={lvl} className="capitalize">
                  {lvl === "all" ? t("levelAll") : lvl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {stream.dropped > 0 ? (
            <p className="border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
              {t("droppedHint", { count: stream.dropped })}
            </p>
          ) : null}
          {filtered.length === 0 ? (
            <EmptyState
              title={stream.loadingHistory ? t("loadingHistory") : t("emptyTitle")}
              description={
                stream.loadingHistory
                  ? t("loadingHistoryHint")
                  : stream.items.length > 0
                    ? t("emptyFiltered")
                    : t("emptyHint")
              }
            />
          ) : (
            <div className="max-h-[70vh] scrollbar-thin overflow-y-auto font-mono text-xs">
              {filtered.map((item, idx) => {
                const ctx = parseContext(item.context);
                return (
                  <div
                    key={idx}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/60 px-4 py-1.5 hover:bg-muted/40"
                  >
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {formatTimestamp(item.createdAt)}
                    </span>
                    <span
                      className={cn(
                        "w-12 shrink-0 font-semibold uppercase",
                        item.level === "error" || item.level === "fatal"
                          ? "text-destructive"
                          : item.level === "warn"
                            ? "text-amber-600 dark:text-amber-400"
                            : item.level === "debug"
                              ? "text-muted-foreground"
                              : "text-sky-600 dark:text-sky-400",
                      )}
                    >
                      {item.level}
                    </span>
                    <span className="font-medium break-words">{item.message}</span>
                    {ctx.length > 0 ? (
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                        {ctx.map(([k, v]) => (
                          <span key={k} className="whitespace-nowrap">
                            <span className="opacity-60">{k}=</span>
                            <span className="text-foreground/80">{v}</span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
