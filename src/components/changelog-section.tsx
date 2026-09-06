"use client";

import { useTranslations } from "next-intl";
import { Bug, Rocket, Sparkles, Wrench } from "lucide-react";
import { CHANGELOG, type ChangelogItemType } from "@/lib/changelog";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

const ITEM_ICON: Record<
  ChangelogItemType,
  React.ComponentType<{ className?: string }>
> = {
  feature: Sparkles,
  improvement: Wrench,
  fix: Bug,
};

const ITEM_TONE: Record<ChangelogItemType, string> = {
  feature: "text-emerald-500",
  improvement: "text-sky-500",
  fix: "text-amber-500",
};

interface ChangelogSectionProps {
  /** Bigger header, accent border and a sparkle icon - use when this is a focal section. */
  prominent?: boolean;
}

export function ChangelogSection({ prominent = false }: ChangelogSectionProps) {
  const t = useTranslations("changelog");

  return (
    <Card
      id="changelog"
      className={cn(
        "scroll-mt-20",
        prominent &&
          "border-primary/40 shadow-md ring-1 ring-primary/10 bg-gradient-to-br from-primary/5 via-transparent to-transparent",
      )}
    >
      <CardHeader>
        <CardTitle
          className={cn(
            "flex items-center gap-2",
            prominent ? "text-xl" : "text-base",
          )}
        >
          {prominent && <Rocket className="h-5 w-5 shrink-0 text-primary" />}
          {t("sectionTitle")}
        </CardTitle>
        <CardDescription>{t("sectionHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {CHANGELOG.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          CHANGELOG.map((entry, i) => (
            <article
              key={entry.version}
              className={i > 0 ? "border-t pt-6" : undefined}
            >
              <header className="flex flex-wrap items-baseline gap-2">
                <h3
                  className={cn(
                    "font-semibold leading-none",
                    prominent && i === 0 && "text-base",
                  )}
                >
                  {entry.title}
                </h3>
                {entry.highlight && (
                  <Badge variant="info">{t("highlightBadge")}</Badge>
                )}
                <Badge variant="muted">v{entry.version}</Badge>
                <span className="text-xs text-muted-foreground">
                  {entry.date}
                </span>
              </header>
              {entry.description && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {entry.description}
                </p>
              )}
              <ul className="mt-3 space-y-1.5 text-sm">
                {entry.items.map((item, idx) => {
                  const Icon = ITEM_ICON[item.type];
                  return (
                    <li key={idx} className="flex items-start gap-2">
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${ITEM_TONE[item.type]}`}
                      />
                      <span>{item.text}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))
        )}
      </CardContent>
    </Card>
  );
}
