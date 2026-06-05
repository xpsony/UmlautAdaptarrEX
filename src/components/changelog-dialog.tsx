"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bug, Sparkles, Wrench } from "lucide-react";
import {
  CHANGELOG,
  type ChangelogEntry,
  type ChangelogItemType,
  latestChangelog,
  unseenSince,
} from "@/lib/changelog";
import { apiFetch } from "@/app/_lib/api-client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const ITEM_ICON: Record<ChangelogItemType, React.ComponentType<{ className?: string }>> = {
  feature: Sparkles,
  improvement: Wrench,
  fix: Bug,
};

const ITEM_TONE: Record<ChangelogItemType, string> = {
  feature: "text-emerald-500",
  improvement: "text-sky-500",
  fix: "text-amber-500",
};

// Mark the current user as having seen the latest changelog, server-side.
// Best-effort: a failed request (e.g. session lost) just leaves the popup to
// reappear next time rather than throwing into the render path.
async function acknowledgeSeen(): Promise<void> {
  try {
    await apiFetch("/api/auth/changelog/seen", { method: "POST" });
  } catch {
    /* non-fatal — the dialog will show again on the next load */
  }
}

export function ChangelogDialog() {
  const t = useTranslations("changelog");
  const [{ open, entries }, setState] = useState<{
    open: boolean;
    entries: ChangelogEntry[];
  }>({ open: false, entries: [] });

  useEffect(() => {
    if (CHANGELOG.length === 0) return;
    const latest = latestChangelog();
    if (!latest) return;
    let cancelled = false;
    void (async () => {
      let lastSeen: string | null;
      try {
        const me = await apiFetch<{ lastSeenChangelog?: string | null }>("/api/auth/me");
        lastSeen = me.lastSeenChangelog ?? null;
      } catch {
        // Not authenticated / request failed — stay closed.
        return;
      }
      if (cancelled) return;
      // First acknowledgement ever (fresh install): record the current version
      // silently so a brand-new admin isn't greeted with the full history.
      if (lastSeen === null) {
        void acknowledgeSeen();
        return;
      }
      if (lastSeen === latest.version) return;
      const items = unseenSince(lastSeen);
      if (items.length > 0) setState({ open: true, entries: items });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    void acknowledgeSeen();
    setState({ open: false, entries: [] });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogIntro")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {entries.map((entry) => (
            <article key={entry.version} className="space-y-2">
              <header className="flex flex-wrap items-baseline gap-2">
                <h3 className="leading-none font-semibold">{entry.title}</h3>
                <Badge variant="muted">v{entry.version}</Badge>
                <span className="text-xs text-muted-foreground">{entry.date}</span>
              </header>
              {entry.description && (
                <p className="text-sm text-muted-foreground">{entry.description}</p>
              )}
              <ul className="space-y-1.5 text-sm">
                {entry.items.map((item, i) => {
                  const Icon = ITEM_ICON[item.type];
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ITEM_TONE[item.type]}`} />
                      <span>{item.text}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" asChild onClick={dismiss}>
            <Link href="/about#changelog">{t("viewAll")}</Link>
          </Button>
          <Button onClick={dismiss}>{t("dismiss")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
