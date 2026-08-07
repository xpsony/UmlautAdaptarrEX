"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { useWatch } from "react-hook-form";
import { CheckCircle2, Loader2 } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Button } from "@/components/ui/button";
import { SecretField } from "@/components/ui/secret-field";
import { isMaskedSecret } from "@/lib/secrets";
import type { ProvidersForm, TmdbTestResult } from "../_lib/settings-types";

interface TmdbKeyFieldProps {
  form: ProvidersForm;
  configured: boolean;
}

export function TmdbKeyField({ form, configured }: TmdbKeyFieldProps) {
  const t = useTranslations("settings");
  const [result, setResult] = useState<TmdbTestResult | null>(null);
  const testMut = useMutation<TmdbTestResult, Error, string>({
    mutationFn: (apiKey: string) =>
      apiFetch<TmdbTestResult>("/api/admin/settings/test-tmdb-key", {
        method: "POST",
        body: JSON.stringify(apiKey ? { apiKey } : {}),
      }),
    onSuccess: (r) => setResult(r),
    onError: (err) => setResult({ ok: false, code: "unknown", detail: err.message }),
  });

  const currentKey = (useWatch({ control: form.control, name: "tmdbApiKey" }) ?? "").toString();

  const onTest = () => {
    // Masked sentinel means "test the stored key"; the admin route falls
    // back to the value persisted in the DB. Trim so trailing whitespace
    // pasted from password managers doesn't break the probe.
    const trimmed = currentKey.trim();
    testMut.mutate(isMaskedSecret(trimmed) ? "" : trimmed);
  };

  return (
    <div className="space-y-2">
      <SecretField
        id="tmdbApiKey"
        name="tmdbApiKey"
        configured={configured}
        // ProvidersForm carries Zod-transformed output types that don't
        // structurally match UseFormReturn<any> under exactOptionalPropertyTypes
        // (RHF's internal validate signature is contravariant). The component
        // only touches control/register/setValue/resetField, so the cast is
        // safe at this leaf boundary.
        form={form as unknown as Parameters<typeof SecretField>[0]["form"]}
        showLabel={t("showKey")}
        hideLabel={t("hideKey")}
        storedLabel={t("secretStored")}
        replaceLabel={t("secretReplace")}
        cancelLabel={t("secretCancel")}
        trailing={
          <Button type="button" variant="outline" onClick={onTest} disabled={testMut.isPending}>
            {testMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {t("tmdbTest")}
          </Button>
        }
      />
      {result?.ok === true ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {t("tmdbTestOk", { title: result.sample.title })}
        </p>
      ) : result?.ok === false ? (
        <p className="text-xs text-destructive">
          {t(`tmdbTestErr.${result.code}`)}
          {result.detail ? ` ${result.detail}` : ""}
        </p>
      ) : null}
    </div>
  );
}
