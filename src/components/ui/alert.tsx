import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex gap-2 rounded-md border [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0", {
  variants: {
    variant: {
      warning:
        "border-amber-300/40 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-950/30 [&_svg]:text-amber-700 dark:[&_svg]:text-amber-400",
      destructive:
        "border-destructive/40 bg-destructive/10 text-destructive [&_svg]:text-destructive",
      success:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 [&_svg]:text-emerald-700 dark:[&_svg]:text-emerald-300",
      info: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400 [&_svg]:text-sky-700 dark:[&_svg]:text-sky-400",
    },
    // Deliberate normalization (not pixel parity with every pre-existing
    // call site): banners get the roomier `default` density, while the
    // inline test-result callouts (prowlarr connect/settings) keep their
    // original compact density via `size="compact"` — no per-call
    // className overrides for padding/text-size/alignment.
    size: {
      default: "items-start p-3 text-sm [&_svg]:mt-0.5",
      compact: "items-center px-3 py-2 text-xs",
    },
  },
  defaultVariants: {
    variant: "info",
    size: "default",
  },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

// Non-critical variants (success/info) use role="status" so assistive tech
// announces them politely; warning/destructive use role="alert" for an
// assertive announcement, matching the plan's a11y contract. Standing
// conditions (e.g. "restart unsupported on this platform") should override
// with an explicit `role="status"` at the call site since they aren't a
// transient event worth an assertive interruption.
function roleForVariant(variant: AlertProps["variant"]): "alert" | "status" {
  return variant === "warning" || variant === "destructive" ? "alert" : "status";
}

export function Alert({ className, variant, size, ...props }: AlertProps) {
  return (
    <div
      role={roleForVariant(variant)}
      className={cn(alertVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("leading-none font-medium", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />;
}
