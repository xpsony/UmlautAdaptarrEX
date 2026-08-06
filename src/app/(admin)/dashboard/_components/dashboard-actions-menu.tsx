"use client";

import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  CloudUpload,
  Download,
  MoreHorizontal,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface DashboardActionsMenuProps {
  isProwlarrConfigured: boolean;
  onOpenImport: () => void;
  onOpenInstallProxy: () => void;
}

export function DashboardActionsMenu({
  isProwlarrConfigured,
  onOpenImport,
  onOpenInstallProxy,
}: DashboardActionsMenuProps) {
  const t = useTranslations("dashboard");
  const importReasonId = useId();
  const proxyReasonId = useId();
  const needsProwlarrReason = isProwlarrConfigured ? undefined : t("actions.needsProwlarr");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <MoreHorizontal className="h-4 w-4" />
          {t("actions.menu")}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/*
         * Radix's MenuItem drops `disabled` items from roving focus AND
         * arrow-key/typeahead navigation entirely (`focusable: !disabled`,
         * plus `getItems().filter((item) => !item.disabled)` for keyboard
         * nav) — a disabled item is unreachable by keyboard, so its helper
         * text below would never be read either. Instead we keep the item
         * itself focusable (no `disabled` prop), mark it `aria-disabled` +
         * style it inert manually, and block the actual action in
         * `onSelect` (covers pointer clicks and keyboard Enter/Space alike,
         * since Radix funnels both through the same select event). The
         * visible reason is linked via `aria-describedby` so focusing the
         * item announces it, not just "Import from Prowlarr".
         */}
        <DropdownMenuItem
          onSelect={(event) => {
            if (!isProwlarrConfigured) {
              event.preventDefault();
              return;
            }
            onOpenImport();
          }}
          aria-disabled={!isProwlarrConfigured || undefined}
          aria-describedby={needsProwlarrReason ? importReasonId : undefined}
          className={cn(
            "flex-col items-start",
            !isProwlarrConfigured && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            <span>{t("actions.prowlarrImport")}</span>
          </span>
          {needsProwlarrReason ? (
            <span id={importReasonId} className="pl-6 text-xs text-muted-foreground">
              {needsProwlarrReason}
            </span>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            if (!isProwlarrConfigured) {
              event.preventDefault();
              return;
            }
            onOpenInstallProxy();
          }}
          aria-disabled={!isProwlarrConfigured || undefined}
          aria-describedby={needsProwlarrReason ? proxyReasonId : undefined}
          className={cn(
            "flex-col items-start",
            !isProwlarrConfigured && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="flex items-center gap-2">
            <CloudUpload className="h-4 w-4" />
            <span>{t("actions.installProxy")}</span>
          </span>
          {needsProwlarrReason ? (
            <span id={proxyReasonId} className="pl-6 text-xs text-muted-foreground">
              {needsProwlarrReason}
            </span>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/sync-runs">
            <RefreshCw className="h-4 w-4" />
            <span>{t("actions.openSyncRuns")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            <span>{t("actions.openSettings")}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
