"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Download, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { describeError } from "@/lib/error-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ProwlarrImportDialog } from "@/components/instances/prowlarr-import-dialog";
import { InstanceDialog } from "./_components/instance-dialog";
import { InstancesMobileList } from "./_components/instances-mobile-list";
import { InstancesTable } from "./_components/instances-table";
import type { Instance, TestConnectionResponse } from "./_lib/instances-types";

export function InstancesClient() {
  const t = useTranslations("instances");
  const tCommon = useTranslations("common");
  // "boundaries" namespace owns the generic retry label; reused for the
  // list-fetch error affordance so it stays translated.
  const tBoundaries = useTranslations("boundaries");
  const locale = useLocale();
  const qc = useQueryClient();

  const list = useQuery<Instance[]>({
    queryKey: ["instances"],
    queryFn: () => apiFetch<Instance[]>("/api/admin/instances"),
  });

  const [editor, setEditor] = useState<{
    open: boolean;
    instance: Instance | null;
  }>({ open: false, instance: null });
  const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null);
  const [prowlarrOpen, setProwlarrOpen] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/instances/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success(t("deleted"));
      setDeleteTarget(null);
    },
    onError: () => toast.error(tCommon("error")),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/admin/instances/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] }),
    onError: () => {
      toast.error(tCommon("error"));
      // The Switch is bound to the query cache (no optimistic write), so no
      // rollback is needed — refetch only to reconcile with server truth.
      void qc.invalidateQueries({ queryKey: ["instances"] });
    },
  });

  const testMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<TestConnectionResponse>(`/api/admin/instances/${id}/test`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      if (result.ok) toast.success(t("testOk", { version: result.version ?? "?" }));
      else toast.error(t("testFail", { error: result.error ?? "" }));
    },
    onError: (err) => toast.error(t("testFail", { error: describeError(err) })),
  });

  const syncMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; runIds: string[]; instanceCount: number }>("/api/admin/sync", {
        method: "POST",
        body: JSON.stringify({ instanceId: id }),
      }),
    onSuccess: () => {
      toast.success(t("syncStarted"));
      void qc.invalidateQueries({ queryKey: ["sync-runs"] });
      void qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (err) => toast.error(describeError(err)),
  });

  const onEdit = (instance: Instance) => setEditor({ open: true, instance });
  const onDelete = (instance: Instance) => setDeleteTarget(instance);
  const onToggle = (id: string, enabled: boolean) => toggleMut.mutate({ id, enabled });
  const onTest = (instance: Instance) => testMut.mutate(instance.id);
  const onSync = (instance: Instance) => syncMut.mutate(instance.id);
  const openCreate = () => setEditor({ open: true, instance: null });

  // `variables` is only meaningful while the mutation is in flight — used to
  // scope the loading/disabled state to the one row that triggered it.
  const testingId = testMut.isPending ? (testMut.variables ?? null) : null;
  const syncingId = syncMut.isPending ? (syncMut.variables ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setProwlarrOpen(true)}>
            <Download className="h-4 w-4" />
            {t("prowlarr.button")}
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">{t("listTitle")}</CardTitle>
          <CardDescription>{t("listSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : list.isLoadingError ? (
            // A failed fetch must not masquerade as "no instances"; show a
            // distinct error with a retry affordance instead.
            <div
              role="alert"
              className="flex flex-col items-center gap-3 p-10 text-center text-sm text-destructive"
            >
              <span>{tCommon("error")}</span>
              <Button
                variant="outline"
                disabled={list.isFetching}
                onClick={() => void list.refetch()}
              >
                {tBoundaries("retry")}
              </Button>
            </div>
          ) : !list.data || list.data.length === 0 ? (
            <EmptyState
              icon={<Database className="h-5 w-5" />}
              title={t("noInstancesTitle")}
              description={t("noInstances")}
              action={
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  {t("add")}
                </Button>
              }
            />
          ) : (
            <>
              {/* Mobile: stacked cards. Tables collapse poorly under ~640px,
                  so we render a scannable card per instance instead. The
                  desktop Table below stays untouched for >=md viewports. */}
              <InstancesMobileList
                instances={list.data}
                locale={locale}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
                onTest={onTest}
                onSync={onSync}
                testingId={testingId}
                syncingId={syncingId}
              />
              <InstancesTable
                instances={list.data}
                locale={locale}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
                onTest={onTest}
                onSync={onSync}
                testingId={testingId}
                syncingId={syncingId}
              />
            </>
          )}
        </CardContent>
      </Card>

      <InstanceDialog
        key={editor.instance?.id ?? "new"}
        open={editor.open}
        instance={editor.instance}
        onClose={() => setEditor({ open: false, instance: null })}
      />

      <ProwlarrImportDialog
        open={prowlarrOpen}
        onOpenChange={setProwlarrOpen}
        onImported={() => qc.invalidateQueries({ queryKey: ["instances"] })}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("deleteTitle", { name: deleteTarget?.name ?? "" })}
        description={t("deleteConfirm", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("delete")}
        confirmIcon={<Trash2 className="h-4 w-4" />}
        destructive
        pending={deleteMut.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
