"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SYNC_PRESETS } from "@/schemas/settings";
import {
  VARIATION_EXAMPLE,
  VARIATION_TYPES,
  type SearchBehaviourValues,
} from "@/app/(admin)/settings/_lib/settings-types";

export type { SearchBehaviourValues };

export interface SearchBehaviourFieldsProps {
  values: SearchBehaviourValues;
  onChange: <K extends keyof SearchBehaviourValues>(
    key: K,
    value: SearchBehaviourValues[K],
  ) => void;
}

type PresetKey = keyof typeof SYNC_PRESETS;
const PRESET_KEYS = ["recommended", "frugal", "legacy"] as const satisfies readonly PresetKey[];

/**
 * The search-behaviour fields, shared by the setup wizard and the
 * Settings -> Suche tab. Same sharing pattern as OperationModePicker.
 *
 * Deliberately not bound to react-hook-form: the wizard holds these in plain
 * state, the settings tab in an RHF instance, and a value/onChange pair is the
 * smallest interface that serves both.
 */
export function SearchBehaviourFields({ values, onChange }: SearchBehaviourFieldsProps) {
  const t = useTranslations("searchBehaviour");

  const presetActive = (key: PresetKey): boolean =>
    values.syncIntervalMinutes === SYNC_PRESETS[key].syncIntervalMinutes &&
    values.fullSyncIntervalHours === SYNC_PRESETS[key].fullSyncIntervalHours;

  // Worst case of one search: the highest cap among the switched-on types,
  // plus q and the canonical title. With every type off, the highest cap
  // overall, so the line still says what switching one on would cost.
  const enabledTypes = VARIATION_TYPES.filter(({ toggle }) => values[toggle]);
  const maxCap = Math.max(
    0,
    ...(enabledTypes.length > 0 ? enabledTypes : VARIATION_TYPES).map(({ cap }) => values[cap]),
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2.5 rounded-md border p-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="onDemandLookup" className="text-sm font-medium">
                {t("onDemand.label")}
              </Label>
              <FieldHint text={t("onDemand.hint")} />
            </div>
            <p className="text-xs text-muted-foreground">{t("onDemand.description")}</p>
          </div>
          <Switch
            id="onDemandLookup"
            checked={values.onDemandLookup}
            onCheckedChange={(v) => onChange("onDemandLookup", v)}
            aria-label={t("onDemand.label")}
          />
        </div>
        <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
          <p>{t("onDemand.example")}</p>
          <p>{t("onDemand.cost")}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{t("variations.label")}</span>
            <FieldHint text={t("variations.hint")} />
          </div>
          <p className="text-xs text-muted-foreground">{t("variations.description")}</p>
        </div>

        <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <span>{t("variations.capLabel")}</span>
          <FieldHint text={t("variations.capHint")} />
        </div>

        {VARIATION_TYPES.map(({ toggle, cap }) => (
          <div key={toggle} className="flex items-center justify-between gap-4">
            <Label htmlFor={toggle} className="text-sm">
              {t(`variations.${toggle}`)}
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id={cap}
                type="number"
                min={0}
                max={20}
                value={values[cap]}
                disabled={!values[toggle]}
                onChange={(e) => onChange(cap, Number(e.target.value))}
                aria-label={t("variations.capAria", { type: t(`variations.${toggle}`) })}
                className="h-8 w-16"
              />
              <Switch
                id={toggle}
                checked={values[toggle]}
                onCheckedChange={(v) => onChange(toggle, v)}
                aria-label={t(`variations.${toggle}`)}
              />
            </div>
          </div>
        ))}

        <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
          <p>
            {t("variations.exampleQuery")}{" "}
            <code className="font-mono break-all text-foreground">{VARIATION_EXAMPLE.query}</code>
          </p>
          <p>{t("variations.exampleExtra")}</p>
          <ul className="list-inside list-disc space-y-0.5">
            {VARIATION_EXAMPLE.variations.map((v) => (
              <li key={v}>
                <code className="font-mono break-all text-foreground">{v}</code>
              </li>
            ))}
          </ul>
          <p>{t("variations.cost", { max: maxCap + 2 })}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="space-y-1">
          <span className="text-sm font-medium">{t("refresh.label")}</span>
          <p className="text-xs text-muted-foreground">{t("refresh.description")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("refresh.presetsLabel")}</span>
          {PRESET_KEYS.map((key) => (
            <Button
              key={key}
              type="button"
              variant={presetActive(key) ? "default" : "outline"}
              size="sm"
              onClick={() => {
                onChange("syncIntervalMinutes", SYNC_PRESETS[key].syncIntervalMinutes);
                onChange("fullSyncIntervalHours", SYNC_PRESETS[key].fullSyncIntervalHours);
              }}
            >
              {t(`refresh.preset.${key}`)}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="syncIntervalMinutes" className="text-sm">
                {t("refresh.quickLabel")}
              </Label>
              <FieldHint text={t("refresh.quickHint")} />
            </div>
            <Input
              id="syncIntervalMinutes"
              type="number"
              min={0}
              max={1440}
              value={values.syncIntervalMinutes}
              onChange={(e) => onChange("syncIntervalMinutes", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">{t("refresh.quickDescription")}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="fullSyncIntervalHours" className="text-sm">
                {t("refresh.fullLabel")}
              </Label>
              <FieldHint text={t("refresh.fullHint")} />
            </div>
            <Input
              id="fullSyncIntervalHours"
              type="number"
              min={1}
              max={168}
              value={values.fullSyncIntervalHours}
              onChange={(e) => onChange("fullSyncIntervalHours", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">{t("refresh.fullDescription")}</p>
          </div>
        </div>

        <Alert role="status">
          <Info className="h-4 w-4" />
          <AlertDescription>{t("refresh.firstScanHint")}</AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
