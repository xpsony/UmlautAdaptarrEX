"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Plug } from "lucide-react";
import {
  type ArrInstanceInput,
  ArrInstanceSchema,
  type ArrType,
  type ProviderId,
} from "@/schemas/instance";
import { isMaskedSecret } from "@/lib/secrets";
import { apiFetch } from "@/app/_lib/api-client";
import { describeError } from "@/lib/error-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldHint } from "@/components/ui/field-hint";
import { ArrIcon } from "@/components/ui/arr-icon";
import {
  ARR_TYPES,
  DEFAULT_PROVIDER_ORDER,
  needsProviderOrder,
  PROVIDER_IDS,
  type ArrInstanceFormInput,
  type Instance,
} from "../_lib/instances-types";
import { ProviderOrderField } from "./provider-order-field";

interface InstanceDialogProps {
  open: boolean;
  instance: Instance | null;
  onClose: () => void;
}

export function InstanceDialog({ open, instance, onClose }: InstanceDialogProps) {
  const t = useTranslations("instances");
  const tCommon = useTranslations("common");
  const qc = useQueryClient();

  const isEdit = instance !== null;
  const apiKeyIsMasked = !!instance && isMaskedSecret(instance.apiKey);
  const { register, handleSubmit, control, formState, reset, setValue } = useForm<
    ArrInstanceFormInput,
    unknown,
    ArrInstanceInput
  >({
    resolver: zodResolver(ArrInstanceSchema),
    defaultValues: instance
      ? {
          type: instance.type,
          name: instance.name,
          host: instance.host,
          apiKey: apiKeyIsMasked ? "" : instance.apiKey,
          enabled: instance.enabled,
          providerOrder: instance.providerOrder ?? DEFAULT_PROVIDER_ORDER[instance.type],
          enableYearMatching: instance.enableYearMatching ?? true,
          yearMatchingTolerance: instance.yearMatchingTolerance ?? 1,
          searchWithoutAuthor: instance.searchWithoutAuthor ?? false,
        }
      : {
          type: "sonarr",
          enabled: true,
          name: "",
          host: "",
          apiKey: "",
          providerOrder: DEFAULT_PROVIDER_ORDER.sonarr,
          enableYearMatching: true,
          yearMatchingTolerance: 1,
          searchWithoutAuthor: false,
        },
  });

  const watchedType = (useWatch({ control, name: "type" }) ?? "sonarr") as ArrType;

  // When the user changes the type we pull in the default for the new
  // type (e.g. Lidarr -> null, so the DnD field disappears). Edits to
  // existing instances are not overwritten because the initial default
  // already came from `instance.providerOrder`.
  useEffect(() => {
    if (isEdit) return;
    setValue("providerOrder", DEFAULT_PROVIDER_ORDER[watchedType] ?? null, {
      shouldDirty: false,
    });
  }, [watchedType, isEdit, setValue]);

  const [testing, setTesting] = useState(false);

  const createMut = useMutation({
    mutationFn: (data: ArrInstanceInput) =>
      apiFetch<Instance>("/api/admin/instances", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instances"] });
      reset();
      toast.success(t("created"));
      onClose();
    },
    onError: () => toast.error(t("testFail", { error: "creation" })),
  });

  const updateMut = useMutation({
    mutationFn: (data: ArrInstanceInput) =>
      apiFetch<Instance>(`/api/admin/instances/${instance!.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success(t("updated"));
      onClose();
    },
    onError: () => toast.error(tCommon("error")),
  });

  async function testConn(values: ArrInstanceInput): Promise<void> {
    setTesting(true);
    try {
      const r = await apiFetch<{
        ok: boolean;
        version?: string;
        error?: string;
      }>("/api/admin/instances/test", {
        method: "POST",
        body: JSON.stringify({
          type: values.type,
          host: values.host,
          apiKey: values.apiKey,
        }),
      });
      if (r.ok) toast.success(t("testOk", { version: r.version ?? "?" }));
      else toast.error(t("testFail", { error: r.error ?? "" }));
    } catch (err) {
      const msg = describeError(err);
      toast.error(t("testFail", { error: msg }));
    } finally {
      setTesting(false);
    }
  }

  function onSubmitForm(values: ArrInstanceInput): void {
    if (isEdit) updateMut.mutate(values);
    else createMut.mutate(values);
  }

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editSubtitle") : t("addSubtitle")}</DialogDescription>
        </DialogHeader>
        <form id="instance-form" onSubmit={handleSubmit(onSubmitForm)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">{t("type")}</Label>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="type" className="capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ARR_TYPES.map((type) => (
                        <SelectItem key={type} value={type} className="capitalize">
                          <span className="flex items-center gap-2">
                            <ArrIcon type={type} size={16} />
                            {type}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{t("name")}</Label>
              <Input id="name" placeholder="Sonarr 4K" {...register("name")} />
              {formState.errors.name ? (
                <p className="text-xs text-destructive">{formState.errors.name.message}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="host">{t("host")}</Label>
              <FieldHint text={t("hostHint")} />
            </div>
            <Input id="host" placeholder="http://sonarr:8989" {...register("host")} />
            {formState.errors.host ? (
              <p className="text-xs text-destructive">{formState.errors.host.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">{t("apiKey")}</Label>
            <Input
              id="apiKey"
              type="password"
              autoComplete="off"
              placeholder={apiKeyIsMasked ? t("apiKeyMaskedPlaceholder") : undefined}
              {...register("apiKey")}
            />
            {formState.errors.apiKey ? (
              <p className="text-xs text-destructive">{formState.errors.apiKey.message}</p>
            ) : apiKeyIsMasked ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t("apiKeyMaskedHint")}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="enabled" className="cursor-pointer">
                {t("enabled")}
              </Label>
              <FieldHint text={t("enabledHint")} />
            </div>
            <Controller
              control={control}
              name="enabled"
              render={({ field }) => (
                <Switch
                  id="enabled"
                  checked={field.value ?? true}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          {needsProviderOrder(watchedType) ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label>{t("providerOrder")}</Label>
                <FieldHint text={t("providerOrderHint")} />
              </div>
              <Controller
                control={control}
                name="providerOrder"
                render={({ field }) => (
                  <ProviderOrderField
                    value={
                      (field.value as ProviderId[] | null) ??
                      DEFAULT_PROVIDER_ORDER[watchedType] ??
                      []
                    }
                    onChange={(next) => field.onChange(next)}
                    available={PROVIDER_IDS}
                  />
                )}
              />
            </div>
          ) : null}

          {needsProviderOrder(watchedType) ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor="enableYearMatching"
                    className="cursor-pointer text-sm font-medium"
                  >
                    {t("enableYearMatching")}
                  </Label>
                  <FieldHint text={t("enableYearMatchingHint")} />
                </div>
                <Controller
                  control={control}
                  name="enableYearMatching"
                  render={({ field }) => (
                    <Switch
                      id="enableYearMatching"
                      checked={field.value ?? true}
                      onCheckedChange={field.onChange}
                      aria-label={t("enableYearMatching")}
                    />
                  )}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="yearMatchingTolerance">{t("yearMatchingTolerance")}</Label>
                  <FieldHint text={t("yearMatchingToleranceHint")} />
                </div>
                <Input
                  id="yearMatchingTolerance"
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  className="max-w-32"
                  {...register("yearMatchingTolerance", {
                    valueAsNumber: true,
                  })}
                />
                {formState.errors.yearMatchingTolerance ? (
                  <p className="text-xs text-destructive">
                    {formState.errors.yearMatchingTolerance.message}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {watchedType === "readarr" || watchedType === "listenarr" ? (
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="searchWithoutAuthor" className="cursor-pointer text-sm font-medium">
                  {t("searchWithoutAuthor")}
                </Label>
                <FieldHint text={t("searchWithoutAuthorHint")} />
              </div>
              <Controller
                control={control}
                name="searchWithoutAuthor"
                render={({ field }) => (
                  <Switch
                    id="searchWithoutAuthor"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                    aria-label={t("searchWithoutAuthor")}
                  />
                )}
              />
            </div>
          ) : null}
        </form>
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleSubmit((d) => testConn(d))}
            disabled={testing || submitting}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            {t("test")}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" form="instance-form" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEdit ? tCommon("save") : t("add")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
