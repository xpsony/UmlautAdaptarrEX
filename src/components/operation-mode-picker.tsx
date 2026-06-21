"use client";

import { useTranslations } from "next-intl";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export type OperationMode = "proxy" | "legacy" | "both";

interface OperationModePickerProps {
  value: OperationMode;
  onChange: (next: OperationMode) => void;
  // Resolved service ports (env override > default), shown in the mode
  // descriptions so the copy matches the actual listeners. Both callers pass
  // the values they resolved server-side; the literal fallbacks here keep the
  // picker self-contained if a caller omits them.
  legacyApiPort?: number;
  proxyPort?: number;
}

// Picker shared by the setup wizard (`src/app/setup/page.tsx`) and the
// Settings page so labels, hints, and the recommended/warning callouts stay
// consistent. Reads its strings from the `setup.mode*` i18n keys.
export function OperationModePicker({
  value,
  onChange,
  legacyApiPort = 5005,
  proxyPort = 5006,
}: OperationModePickerProps) {
  const t = useTranslations("setup");
  const ports = { legacyApiPort, proxyPort };
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as OperationMode)}
      className="space-y-3"
      aria-label={t("modeTitle")}
    >
      <ModeOption
        value="proxy"
        label={t("modeProxyLabel")}
        description={t("modeProxyDescription", ports)}
        details={t("modeProxyDetails")}
        recommended
      />
      <ModeOption
        value="legacy"
        label={t("modeLegacyLabel")}
        description={t("modeLegacyDescription", ports)}
        details={t("modeLegacyDetails", ports)}
      />
      <ModeOption
        value="both"
        label={t("modeBothLabel")}
        description={t("modeBothDescription", ports)}
        details={t("modeBothDetails")}
        warning={t("modeBothWarning")}
      />
    </RadioGroup.Root>
  );
}

function ModeOption({
  value,
  label,
  description,
  details,
  recommended,
  warning,
}: {
  value: OperationMode;
  label: string;
  description: string;
  details: string;
  recommended?: boolean;
  warning?: string;
}) {
  const t = useTranslations("setup");
  return (
    <HoverCard openDelay={250} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div>
          <RadioGroup.Item
            value={value}
            className={cn(
              "group w-full rounded-md border p-4 text-left transition-colors",
              "border-border bg-card hover:bg-accent/40",
              "data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 data-[state=checked]:ring-1 data-[state=checked]:ring-primary",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{label}</span>
                  {recommended ? (
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {t("modeRecommendedBadge")}
                    </Badge>
                  ) : null}
                  <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
                {warning ? (
                  <p className="flex items-start gap-1.5 pt-1 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{warning}</span>
                  </p>
                ) : null}
              </div>
              <CheckCircle2
                className={cn(
                  "h-5 w-5 shrink-0 text-primary opacity-0 transition-opacity",
                  "group-data-[state=checked]:opacity-100",
                )}
              />
            </div>
          </RadioGroup.Item>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="text-xs leading-relaxed">
        <p className="mb-1 font-medium">{label}</p>
        <p className="text-muted-foreground">{details}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
