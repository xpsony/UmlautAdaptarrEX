"use client";

import { useTranslations } from "next-intl";
import { Controller } from "react-hook-form";
import { Info, PenLine, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint } from "@/components/ui/field-hint";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DEFAULT_RENAME_PRESET, LEGACY_RENAME_PRESET } from "@/schemas/settings";
import { SaveBar } from "./save-bar";
import { RENAMING_EXAMPLES, RENAMING_TOGGLES } from "../_lib/settings-types";
import type {
  RenamingExample,
  RenamingForm,
  RenamingFormOutput,
  RenamingToggle,
} from "../_lib/settings-types";

interface RenamingTabProps {
  form: RenamingForm;
  onSave: (data: RenamingFormOutput) => void;
  saving: boolean;
}

// The two presets flip the five behaviour flags at once.
// `renameAttachExternalIds` is deliberately NOT part of either: adding
// newznab id attributes is orthogonal to how aggressively the title is
// rewritten, and silently switching it with a preset would surprise.
function applyPreset(
  form: RenamingForm,
  preset: typeof LEGACY_RENAME_PRESET | typeof DEFAULT_RENAME_PRESET,
): void {
  for (const [key, value] of Object.entries(preset)) {
    form.setValue(key as keyof RenamingFormOutput, value, {
      shouldDirty: true,
    });
  }
}

/**
 * Worked before/after example for one toggle. Release names stay verbatim
 * (they are data, not prose - see RENAMING_EXAMPLES); only the labels are
 * translated. `overflow-x-auto` keeps a long release name from widening the
 * card on narrow screens.
 */
function ToggleExample({
  name,
  example,
  checked,
}: {
  name: RenamingToggle;
  example: RenamingExample;
  checked: boolean;
}) {
  const tr = useTranslations("settings.renaming");
  const rows: { label: string; value: string | null; active: boolean }[] = [
    { label: tr("exampleOff"), value: example.off, active: !checked },
    { label: tr("exampleOn"), value: example.on, active: checked },
  ];

  return (
    <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5 text-xs">
      <p className="text-muted-foreground">
        {tr("exampleRelease")}{" "}
        <code className="font-mono break-all text-foreground">{example.input}</code>
      </p>
      {example.item ? (
        <p className="text-muted-foreground">
          {tr("exampleItem")} <span className="text-foreground">{example.item}</span>
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-0.5">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th
                  scope="row"
                  className={cn(
                    "pr-2 text-left align-top font-medium whitespace-nowrap",
                    row.active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {row.label}
                </th>
                <td className="align-top">
                  {row.value === null ? (
                    <span className="text-muted-foreground italic">{tr("exampleNotRenamed")}</span>
                  ) : (
                    <code
                      className={cn(
                        "font-mono break-all whitespace-pre-wrap",
                        row.active ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {row.value}
                    </code>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {example.noteKey ? <p className="text-muted-foreground">{tr(example.noteKey)}</p> : null}
      <p className="sr-only">{tr(`${name}.description`)}</p>
    </div>
  );
}

export function RenamingTab({ form, onSave, saving }: RenamingTabProps) {
  const t = useTranslations("settings");
  const tr = useTranslations("settings.renaming");

  return (
    <form id="renaming-form" onSubmit={form.handleSubmit(onSave)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="h-4 w-4" />
            {t("section.renaming")}
          </CardTitle>
          <CardDescription>{tr("hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert role="status">
            <Info className="h-4 w-4" />
            <AlertDescription>{tr("scopeHint")}</AlertDescription>
          </Alert>

          <div className="space-y-3">
            {RENAMING_TOGGLES.map((name) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => {
                  const checked = field.value ?? false;
                  return (
                    <div className="space-y-2.5 rounded-md border p-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Label htmlFor={name} className="text-sm font-medium">
                              {tr(`${name}.label`)}
                            </Label>
                            <FieldHint text={tr(`${name}.hint`)} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {tr(`${name}.description`)}
                          </p>
                        </div>
                        <Switch
                          id={name}
                          checked={checked}
                          onCheckedChange={field.onChange}
                          aria-label={tr(`${name}.label`)}
                        />
                      </div>
                      <ToggleExample
                        name={name}
                        example={RENAMING_EXAMPLES[name]}
                        checked={checked}
                      />
                    </div>
                  );
                }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <span className="text-xs text-muted-foreground">{tr("presetsLabel")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset(form, LEGACY_RENAME_PRESET)}
            >
              {tr("presetLegacy")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset(form, DEFAULT_RENAME_PRESET)}
            >
              <RotateCcw className="h-4 w-4" />
              {tr("presetRecommended")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <SaveBar form="renaming-form" pending={saving} dirty={form.formState.isDirty} />
    </form>
  );
}
