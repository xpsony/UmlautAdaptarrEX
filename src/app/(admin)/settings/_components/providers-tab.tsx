"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveBar } from "./save-bar";
import { TmdbKeyField } from "./tmdb-key-field";
import { TvdbKeyField } from "./tvdb-key-field";
import type { ProvidersForm, ProvidersFormOutput, SettingsRow } from "../_lib/settings-types";

interface ProvidersTabProps {
  form: ProvidersForm;
  data: SettingsRow | undefined;
  onSave: (data: ProvidersFormOutput) => void;
  saving: boolean;
}

export function ProvidersTab({ form, data, onSave, saving }: ProvidersTabProps) {
  const t = useTranslations("settings");
  // `*Configured` flags come from the server (see admin/settings.ts GET) so
  // the UI can render a "stored" state without ever holding the cleartext
  // key. Default to false until the initial fetch resolves, otherwise we'd
  // briefly show the editable input for already-configured keys.
  const tmdbConfigured = data?.tmdbConfigured === true;
  const tvdbConfigured = data?.tvdbConfigured === true;
  const tvdbPinConfigured = data?.tvdbPinConfigured === true;
  return (
    <form id="providers-form" onSubmit={form.handleSubmit(onSave)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("section.providers")}</CardTitle>
          <CardDescription>{t("section.providersHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="titleApiHost">{t("titleApiHost")}</Label>
            <Input id="titleApiHost" {...form.register("titleApiHost")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tmdbApiKey">{t("tmdbApiKey")}</Label>
            <TmdbKeyField key={`tmdb-${tmdbConfigured}`} form={form} configured={tmdbConfigured} />
            <p className="text-xs text-muted-foreground">
              {t("tmdbApiKeyHint")}{" "}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("tmdbApiKeyLink")}
              </a>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tvdbApiKey">{t("tvdbApiKey")}</Label>
            <TvdbKeyField
              key={`tvdb-${tvdbConfigured}-${tvdbPinConfigured}`}
              form={form}
              apiKeyConfigured={tvdbConfigured}
              pinConfigured={tvdbPinConfigured}
            />
            <p className="text-xs text-muted-foreground">
              {t("tvdbApiKeyHint")}{" "}
              <a
                href="https://thetvdb.com/api-information"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("tvdbApiKeyLink")}
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
      <SaveBar form="providers-form" pending={saving} dirty={form.formState.isDirty} />
    </form>
  );
}
