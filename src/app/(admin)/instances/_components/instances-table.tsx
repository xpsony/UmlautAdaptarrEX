"use client";

import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrIcon, type ArrIconType } from "@/components/ui/arr-icon";
import { InstanceRowActions } from "./instance-row-actions";
import { InstanceStatusBadge } from "./instance-status-badge";
import type { Instance } from "../_lib/instances-types";

interface InstancesTableProps {
  instances: Instance[];
  locale: string;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (instance: Instance) => void;
  onDelete: (instance: Instance) => void;
}

export function InstancesTable({
  instances,
  locale,
  onToggle,
  onEdit,
  onDelete,
}: InstancesTableProps) {
  const t = useTranslations("instances");
  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("type")}</TableHead>
            <TableHead>{t("host")}</TableHead>
            <TableHead>{t("status")}</TableHead>
            <TableHead>{t("lastSync")}</TableHead>
            <TableHead className="w-[60px] text-right">
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((inst) => (
            <TableRow key={inst.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <ArrIcon type={inst.type as ArrIconType} size={20} />
                  <span>{inst.name}</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {inst.type}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{inst.host}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={inst.enabled}
                    onCheckedChange={(checked) => onToggle(inst.id, checked)}
                    aria-label={t("enableAria", { name: inst.name })}
                  />
                  <InstanceStatusBadge enabled={inst.enabled} lastSyncError={inst.lastSyncError} />
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {inst.lastSyncAt ? new Date(inst.lastSyncAt).toLocaleString(locale) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <InstanceRowActions instance={inst} onEdit={onEdit} onDelete={onDelete} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
