"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { useWatch } from "react-hook-form";
import { CheckCircle2, Loader2 } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field-hint";
import { Label } from "@/components/ui/label";
import { SecretField } from "@/components/ui/secret-field";
import { isMaskedSecret } from "@/lib/secrets";
import type { ProvidersForm, TvdbTestResult } from "../_lib/settings-types";

interface TvdbKeyFieldProps {
  form: ProvidersForm;
  apiKeyConfigured: boolean;
  pinConfigured: boolean;
}

export function TvdbKeyField({ form, apiKeyConfigured, pinConfigured }: TvdbKeyFieldProps) {
  const t = useTranslations("settings");
  const [result, setResult] = useState<TvdbTestResult | null>(null);
  const testMut = useMutation<TvdbTestResult, Error, { apiKey: string; pin: string }>({
    mutationFn: ({ apiKey, pin }) =>
      apiFetch<TvdbTestResult>("/api/admin/settings/test-tvdb-key", {
        method: "POST",
        body: JSON.stringify({
          ...(apiKey ? { apiKey } : {}),
          ...(pin ? { pin } : {}),
        }),
      }),
    onSuccess: (r) => setResult(r),
    onError: (err) => setResult({ ok: false, code: "unknown", detail: err.message }),
  });

  const currentKey = (useWatch({ control: form.control, name: "tvdbApiKey" }) ?? "").toString();
  const currentPin = (useWatch({ control: form.control, name: "tvdbPin" }) ?? "").toString();

  // Masked sentinels mean "test the stored value"; the admin route falls back
  // to the persisted key/pin when the body field is empty.
  const onTest = () => {
    const k = currentKey.trim();
    const p = currentPin.trim();
    testMut.mutate({
      apiKey: isMaskedSecret(k) ? "" : k,
      pin: isMaskedSecret(p) ? "" : p,
    });
  };

  // ProvidersForm's UseFormReturn carries Zod-transformed output generics that don't
  // structurally match SecretField's relaxed signature under
  // exactOptionalPropertyTypes (validate is contravariant). SecretField only
  // touches control/register/setValue/resetField, so the cast is safe here.
  const formForSecret = form as unknown as Parameters<typeof SecretField>[0]["form"];

  return (
    <div className="space-y-3">
      <SecretField
        id="tvdbApiKey"
        name="tvdbApiKey"
        configured={apiKeyConfigured}
        form={formForSecret}
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
            {t("tvdbTest")}
          </Button>
        }
      />
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="tvdbPin" className="text-xs text-muted-foreground">
            {t("tvdbPin")}
          </Label>
          <FieldHint text={t("tvdbPinHint")} />
        </div>
        <SecretField
          id="tvdbPin"
          name="tvdbPin"
          configured={pinConfigured}
          form={formForSecret}
          showLabel={t("showKey")}
          hideLabel={t("hideKey")}
          storedLabel={t("secretStored")}
          replaceLabel={t("secretReplace")}
          cancelLabel={t("secretCancel")}
          placeholder={t("tvdbPinPlaceholder")}
        />
      </div>
      {result?.ok === true ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {t("tvdbTestOk", { title: result.sample.title })}
        </p>
      ) : result?.ok === false ? (
        <p className="text-xs text-destructive">
          {t(`tvdbTestErr.${result.code}`)}
          {result.detail ? ` ${result.detail}` : ""}
        </p>
      ) : null}
    </div>
  );
}
