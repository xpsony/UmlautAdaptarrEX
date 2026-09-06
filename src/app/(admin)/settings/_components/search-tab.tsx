"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SearchBehaviourFields,
  type SearchBehaviourValues,
} from "@/components/search-behaviour-fields";
import { SaveBar } from "./save-bar";
import { SEARCH_DEFAULTS } from "../_lib/settings-types";
import type { SearchForm, SearchFormOutput } from "../_lib/settings-types";

interface SearchTabProps {
  form: SearchForm;
  onSave: (data: SearchFormOutput) => void;
  saving: boolean;
}

export function SearchTab({ form, onSave, saving }: SearchTabProps) {
  const t = useTranslations("settings");
  // `watch()` rather than per-field Controllers: SearchBehaviourFields takes a
  // plain value/onChange pair so the wizard can reuse it with local state.
  //
  // The form is a partial schema, so every field is undefined until the
  // settings query resolves. Filling in the schema-derived defaults keeps the
  // switches and number inputs controlled from the first render.
  const watched = form.watch();
  const values: SearchBehaviourValues = {
    onDemandLookup: watched.onDemandLookup ?? SEARCH_DEFAULTS.onDemandLookup,
    tvVariationSearch: watched.tvVariationSearch ?? SEARCH_DEFAULTS.tvVariationSearch,
    movieVariationSearch: watched.movieVariationSearch ?? SEARCH_DEFAULTS.movieVariationSearch,
    maxTitleVariations: watched.maxTitleVariations ?? SEARCH_DEFAULTS.maxTitleVariations,
    syncIntervalMinutes: watched.syncIntervalMinutes ?? SEARCH_DEFAULTS.syncIntervalMinutes,
    fullSyncIntervalHours: watched.fullSyncIntervalHours ?? SEARCH_DEFAULTS.fullSyncIntervalHours,
  };

  const onChange = <K extends keyof SearchBehaviourValues>(
    key: K,
    value: SearchBehaviourValues[K],
  ): void => {
    // RHF's setValue generics cannot express "this key accepts this value
    // type" for a caller-side generic K. The SearchBehaviourValues signature
    // above is what actually keeps callers honest; this only bridges the gap.
    form.setValue(key, value as never, { shouldDirty: true });
  };

  return (
    <form id="search-form" onSubmit={form.handleSubmit(onSave)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            {t("section.search")}
          </CardTitle>
          <CardDescription>{t("section.searchHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchBehaviourFields values={values} onChange={onChange} />
        </CardContent>
      </Card>

      <SaveBar form="search-form" pending={saving} dirty={form.formState.isDirty} />
    </form>
  );
}
