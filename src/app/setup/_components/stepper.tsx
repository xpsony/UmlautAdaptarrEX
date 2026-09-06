import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Step } from "../_lib/setup-wizard";

interface StepperProps {
  steps: { key: Step; label: string }[];
  currentIndex: number;
}

export function Stepper({ steps, currentIndex }: StepperProps) {
  const t = useTranslations("setup");
  return (
    <ol
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
      aria-label={t("stepperLabel")}
    >
      {steps.map((s, i) => (
        <li
          key={s.key}
          className="flex items-center gap-2"
          aria-current={i === currentIndex ? "step" : undefined}
        >
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border bg-card text-xs font-medium",
              i <= currentIndex ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {i < currentIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              "font-medium",
              i <= currentIndex ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 ? <span className="h-px w-6 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}
