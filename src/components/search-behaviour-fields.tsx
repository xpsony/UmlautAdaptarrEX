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
  VARIATION_TOGGLES,
  type VariationToggle,
} from "@/app/(admin)/settings/_lib/settings-types";

export interface SearchBehaviourValues {
  onDemandLookup: boolean;
  tvVariationSearch: boolean;
  movieVariationSearch: boolean;
  maxTitleVariations: number;
  syncIntervalMinutes: number;
  fullSyncIntervalHours: number;
}

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
 * The six search-behaviour fields, shared by the setup wizard and the
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

        {VARIATION_TOGGLES.map((name: VariationToggle) => (
          <div key={name} className="flex items-center justify-between gap-4">
            <Label htmlFor={name} className="text-sm">
              {t(`variations.${name}`)}
            </Label>
            <Switch
              id={name}
              checked={values[name]}
              onCheckedChange={(v) => onChange(name, v)}
              aria-label={t(`variations.${name}`)}
            />
          </div>
        ))}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="maxTitleVariations" className="text-sm">
              {t("variations.capLabel")}
            </Label>
            <FieldHint text={t("variations.capHint")} />
          </div>
          <Input
            id="maxTitleVariations"
            type="number"
            min={1}
            max={20}
            value={values.maxTitleVariations}
            onChange={(e) => onChange("maxTitleVariations", Number(e.target.value))}
            className="w-20"
          />
        </div>

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
          <p>{t("variations.cost", { max: values.maxTitleVariations + 2 })}</p>
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
