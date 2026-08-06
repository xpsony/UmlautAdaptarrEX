"use client";

import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrIcon, type ArrIconType } from "@/components/ui/arr-icon";
import { InstanceRowActions } from "./instance-row-actions";
import { InstanceStatusBadge } from "./instance-status-badge";
import type { Instance } from "../_lib/instances-types";

interface InstancesMobileListProps {
  instances: Instance[];
  locale: string;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (instance: Instance) => void;
  onDelete: (instance: Instance) => void;
}

export function InstancesMobileList({
  instances,
  locale,
  onToggle,
  onEdit,
  onDelete,
}: InstancesMobileListProps) {
  const t = useTranslations("instances");
  return (
    <ul className="divide-y md:hidden">
      {instances.map((inst) => (
        <li key={inst.id} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <ArrIcon type={inst.type as ArrIconType} size={24} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{inst.name}</span>
                  <Badge variant="outline" className="capitalize">
                    {inst.type}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {inst.host}
                </p>
              </div>
            </div>
            <InstanceRowActions instance={inst} onEdit={onEdit} onDelete={onDelete} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={inst.enabled}
                onCheckedChange={(checked) => onToggle(inst.id, checked)}
                aria-label={t("enableAria", { name: inst.name })}
              />
              <InstanceStatusBadge enabled={inst.enabled} lastSyncError={inst.lastSyncError} />
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {inst.lastSyncAt ? new Date(inst.lastSyncAt).toLocaleString(locale) : "—"}
            </span>
          </div>
          {inst.lastSyncError ? (
            <p className="rounded-md bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
              {inst.lastSyncError}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
