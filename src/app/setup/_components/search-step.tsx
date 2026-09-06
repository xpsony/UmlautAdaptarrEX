"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SearchBehaviourFields,
  type SearchBehaviourValues,
} from "@/components/search-behaviour-fields";

interface SearchStepProps {
  values: SearchBehaviourValues;
  onChange: <K extends keyof SearchBehaviourValues>(
    key: K,
    value: SearchBehaviourValues[K],
  ) => void;
  onBack: () => void;
  onNext: () => void;
}

export function SearchStep({ values, onChange, onBack, onNext }: SearchStepProps) {
  const t = useTranslations("setup");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("searchStepTitle")}</CardTitle>
          <CardDescription>{t("searchStepHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchBehaviourFields values={values} onChange={onChange} />
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
