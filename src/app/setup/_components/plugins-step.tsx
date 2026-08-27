"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, ChevronDown, Info, Loader2, Plug } from "lucide-react";
import type { PluginListEntry } from "@/schemas/plugins";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PluginsStepProps {
  pluginList: PluginListEntry[] | null;
  pluginEnabled: Map<string, boolean>;
  tmdbKey: string;
  onTogglePlugin: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function PluginsStep({
  pluginList,
  pluginEnabled,
  tmdbKey,
  onTogglePlugin,
  onBack,
  onNext,
}: PluginsStepProps) {
  const t = useTranslations("setup");
  const tCommon = useTranslations("common");
  const tmdbConfigured = tmdbKey.trim().length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("pluginsTitle")}</CardTitle>
          <CardDescription>{t("pluginsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Per-plugin query cost — shown before the checkboxes so the
              trade-off is visible while choosing, not after. */}
          <Alert role="status">
            <Info className="h-4 w-4" />
            <AlertDescription>{t("pluginsCostHint")}</AlertDescription>
          </Alert>
          {!tmdbConfigured ? (
            // Standing condition (missing TMDB key), not a transient event —
            // role="status" instead of the warning variant's default "alert".
            <Alert variant="warning" role="status">
              <Plug className="h-4 w-4" />
              <AlertDescription>{t("pluginsTmdbBanner")}</AlertDescription>
            </Alert>
          ) : null}
          {!pluginList ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{tCommon("loading")}</span>
            </div>
          ) : pluginList.length === 0 ? (
            <p className="rounded-md border bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("pluginsEmpty")}
            </p>
          ) : (
            <PluginGroups
              pluginList={pluginList}
              pluginEnabled={pluginEnabled}
              tmdbConfigured={tmdbConfigured}
              onTogglePlugin={onTogglePlugin}
            />
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <Button type="button" onClick={onNext}>
          {t("nextStep")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function PluginGroups({
  pluginList,
  pluginEnabled,
  tmdbConfigured,
  onTogglePlugin,
}: {
  pluginList: PluginListEntry[];
  pluginEnabled: Map<string, boolean>;
  tmdbConfigured: boolean;
  onTogglePlugin: (id: string) => void;
}) {
  const t = useTranslations("setup");
  const tPlugins = useTranslations("plugins");

  // Stable language order: de first (most common), then alphabetic.
  const groups = new Map<string, PluginListEntry[]>();
  for (const p of pluginList) {
    const list = groups.get(p.language) ?? [];
    list.push(p);
    groups.set(p.language, list);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (a === "de") return -1;
    if (b === "de") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-2">
      {ordered.map(([lang, plugins]) => (
        <PluginLanguageGroup
          key={`lang-${lang}`}
          language={lang}
          plugins={plugins}
          pluginEnabled={pluginEnabled}
          tmdbConfigured={tmdbConfigured}
          onTogglePlugin={onTogglePlugin}
          languageLabel={languageLabel(t, lang)}
          tPlugins={tPlugins}
          defaultBadge={t("pluginsDefaultBadge")}
        />
      ))}
    </div>
  );
}

function PluginLanguageGroup({
  language,
  plugins,
  pluginEnabled,
  tmdbConfigured,
  onTogglePlugin,
  languageLabel,
  tPlugins,
  defaultBadge,
}: {
  language: string;
  plugins: PluginListEntry[];
  pluginEnabled: Map<string, boolean>;
  tmdbConfigured: boolean;
  onTogglePlugin: (id: string) => void;
  languageLabel: string;
  tPlugins: (key: string) => string;
  defaultBadge: string;
}) {
  const [open, setOpen] = useState(true);
  const enabledCount = plugins.reduce(
    (n, p) => n + ((pluginEnabled.get(p.id) ?? p.enabled) ? 1 : 0),
    0,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center justify-between gap-3 px-3 py-2 text-sm",
          "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "data-[state=open]:rounded-b-none",
        )}
      >
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[10px] tracking-wide uppercase">
            {language}
          </Badge>
          <span className="font-medium">{languageLabel}</span>
          <span className="text-xs text-muted-foreground">
            {enabledCount}/{plugins.length}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y border-t text-sm">
          {plugins.map((p) => {
            const checked = pluginEnabled.get(p.id) ?? p.enabled;
            const nameSlug = p.nameKey.replace(/^plugins\./, "");
            const descSlug = p.descriptionKey.replace(/^plugins\./, "");
            const blocked = p.language !== "de" && !tmdbConfigured && !checked;
            return (
              <li key={`plugin-${p.id}`} className="flex items-start gap-3 px-3 py-2.5">
                <Checkbox
                  id={`plugin-${p.id}`}
                  checked={checked}
                  onCheckedChange={() => onTogglePlugin(p.id)}
                  disabled={blocked}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`plugin-${p.id}`}
                  className="flex flex-1 flex-col items-start gap-1 font-normal"
                >
                  <div className="flex items-center gap-2">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{tPlugins(nameSlug)}</span>
                    {p.defaultEnabled ? (
                      <Badge variant="outline" className="text-[10px] tracking-wide uppercase">
                        {defaultBadge}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{tPlugins(descSlug)}</span>
                </Label>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function languageLabel(t: (key: string) => string, lang: string): string {
  const key = `pluginsLanguage.${lang}`;
  const value = t(key);
  // next-intl returns the key itself when missing — fall back to the raw code.
  return value === key ? lang.toUpperCase() : value;
}
