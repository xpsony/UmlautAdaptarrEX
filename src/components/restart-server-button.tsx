"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Power } from "lucide-react";
import { ApiError, apiFetch } from "@/app/_lib/api-client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError } from "@/lib/error-format";

interface SystemCapabilities {
  canRestart: boolean;
}

type Phase = "idle" | "confirming" | "restarting" | "waiting";

interface RestartButtonProps {
  /** Override label for the trigger button (e.g. "Save & restart"). */
  label?: string;
  /** Pre-restart hook (e.g. save form). Restart aborts if this throws. */
  beforeRestart?: () => Promise<void> | void;
  variant?: "default" | "outline" | "destructive";
  size?: "default" | "sm" | "lg";
  className?: string;
  disabled?: boolean;
}

// Self-contained restart trigger: confirms, calls the API, polls /api/health
// until the server is back, then forces a full reload so React-Query state
// and websocket subscriptions reset cleanly. The button is gated on the
// `/api/admin/system/capabilities.canRestart` flag - when running under
// `tsx watch` (dev) it stays disabled because nothing would respawn the
// process.
export function RestartServerButton(props: RestartButtonProps) {
  const t = useTranslations("settings.restart");
  const tCommon = useTranslations("common");
  const [phase, setPhase] = useState<Phase>("idle");

  const caps = useQuery<SystemCapabilities>({
    queryKey: ["system-capabilities"],
    queryFn: () =>
      apiFetch<SystemCapabilities>("/api/admin/system/capabilities"),
    staleTime: 60_000,
  });
  const canRestart = caps.data?.canRestart ?? false;

  const trigger = async () => {
    setPhase("restarting");
    try {
      if (props.beforeRestart) await props.beforeRestart();
      await apiFetch("/api/admin/system/restart", { method: "POST" });
      setPhase("waiting");
      // Poll /api/health until the server answers again. Bail out after
      // ~30 attempts (~30s) so a stuck deploy doesn't lock up the UI.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const res = await fetch("/api/health", { cache: "no-store" });
          if (res.ok) {
            window.location.reload();
            return;
          }
        } catch {
          /* still down - keep polling */
        }
      }
      toast.error(t("timeout"));
      setPhase("idle");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) {
        toast.error(tCommon("error"));
      } else {
        toast.error(
          t("failed", {
            error: describeError(err),
          }),
        );
      }
      setPhase("idle");
    }
  };

  // Closing the dialog while we're already restarting would leave the spinner
  // visible without a way out, keep the dialog open through `waiting`.
  const dialogOpen =
    phase === "confirming" || phase === "restarting" || phase === "waiting";
  const busy = phase === "restarting" || phase === "waiting";

  return (
    <>
      <Button
        type="button"
        variant={props.variant ?? "destructive"}
        size={props.size ?? "default"}
        onClick={() => setPhase("confirming")}
        disabled={
          props.disabled ||
          !canRestart ||
          phase === "restarting" ||
          phase === "waiting"
        }
        className={props.className}
        title={!canRestart ? t("unsupportedTitle") : undefined}
      >
        {phase === "restarting" || phase === "waiting" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Power className="h-4 w-4" />
        )}
        {props.label ?? t("button")}
      </Button>

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={(open: boolean) => {
          if (!open && phase === "confirming") setPhase("idle");
        }}
        title={t("confirmTitle")}
        description={
          phase === "waiting"
            ? t("waitingHint")
            : phase === "restarting"
              ? t("restartingHint")
              : t("confirmHint")
        }
        confirmLabel={t("button")}
        confirmIcon={<Power className="h-4 w-4" />}
        pending={busy}
        onConfirm={() => void trigger()}
      />
    </>
  );
}

// Read-only hook used by callers that want to render their own restart UI
// (e.g. an inline banner) but still respect the supervisor capability flag.
export function useCanRestart(): boolean {
  const caps = useQuery<SystemCapabilities>({
    queryKey: ["system-capabilities"],
    queryFn: () =>
      apiFetch<SystemCapabilities>("/api/admin/system/capabilities"),
    staleTime: 60_000,
  });
  return caps.data?.canRestart ?? false;
}
