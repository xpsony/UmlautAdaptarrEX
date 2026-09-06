"use client";

import { useTranslations } from "next-intl";
import {
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plug,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Instance } from "../_lib/instances-types";

interface InstanceRowActionsProps {
  instance: Instance;
  onEdit: (instance: Instance) => void;
  onDelete: (instance: Instance) => void;
  onTest: (instance: Instance) => void;
  onSync: (instance: Instance) => void;
  /** True while a test-connection request for this exact instance is in flight. */
  testing: boolean;
  /** True while a sync request for this exact instance is in flight. */
  syncing: boolean;
}

export function InstanceRowActions({
  instance,
  onEdit,
  onDelete,
  onTest,
  onSync,
  testing,
  syncing,
}: InstanceRowActionsProps) {
  const t = useTranslations("instances");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("actions")}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={instance.host} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            {t("open")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(instance)}>
          <Pencil className="h-4 w-4" />
          {t("edit")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onTest(instance)} disabled={testing}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          {t("test")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSync(instance)} disabled={syncing || !instance.enabled}>
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("syncNow")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(instance)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
