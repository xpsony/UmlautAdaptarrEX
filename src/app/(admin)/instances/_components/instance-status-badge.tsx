"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface InstanceStatusBadgeProps {
  enabled: boolean;
  lastSyncError: string | null;
}

export function InstanceStatusBadge({ enabled, lastSyncError }: InstanceStatusBadgeProps) {
  const t = useTranslations("instances");
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  if (lastSyncError) {
    // HoverCard (not Tooltip) so the full error text can wrap in a rich
    // panel. Radix's HoverCardTrigger wires onFocus/onBlur to the same
    // open/close handlers as pointer enter/leave, so keyboard focus opens
    // it too -- but Radix deliberately ignores touch input for hover-open
    // (`excludeTouch` on the pointer handlers, plus a `preventDefault` on
    // touch elsewhere in the primitive), so a tap on a touch device would
    // never open it through Radix's own logic alone. We run the HoverCard
    // as a controlled component (`open`/`onOpenChange`) so Radix's own
    // hover/focus signals keep working via `onOpenChange`, while the
    // trigger's `onClick` independently toggles the same state -- covering
    // touch (and click-to-toggle on desktop). The full error text is also
    // duplicated into an `sr-only` span inside the trigger, always present
    // in the DOM regardless of whether the (portalled, presence-based)
    // HoverCardContent is currently mounted, and wired via
    // `aria-describedby` so focusing the trigger announces the actual
    // error, not just the "Fehler" badge label. That span is `aria-hidden`
    // so it doesn't *also* fold into the button's own accessible name via
    // name-from-content -- aria-describedby still resolves an aria-hidden
    // node when referenced directly by id, so the description still reads
    // correctly without being announced a second time as the name.
    return (
      <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-describedby={detailsId}
            className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none"
          >
            <Badge variant="destructive" className="cursor-help gap-1">
              <AlertCircle className="h-3 w-3" />
              {t("statusError")}
            </Badge>
            <span id={detailsId} aria-hidden="true" className="sr-only">
              {t("statusErrorHeading")}: {lastSyncError}
            </span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="text-xs leading-relaxed">
          <p className="mb-1 font-medium">{t("statusErrorHeading")}</p>
          <p className="break-words text-muted-foreground">{lastSyncError}</p>
        </HoverCardContent>
      </HoverCard>
    );
  }
  if (enabled) {
    return <Badge variant="success">{t("statusOk")}</Badge>;
  }
  return <Badge variant="muted">{t("statusDisabled")}</Badge>;
}
