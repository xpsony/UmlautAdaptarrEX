import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  variant?: "mark" | "wordmark" | "wordmark-wide";
  /** height in px - width scales to preserve aspect ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
  /**
   * In dark mode the black wordmark is swapped for a light variant (the
   * gold accent stays unchanged). Set to `false` when the logo should
   * always look the same, e.g. on a permanently dark background.
   */
  themeAware?: boolean;
}

const SOURCES = {
  mark: {
    light: "/brand/logo-mark.svg",
    dark: "/brand/logo-mark-dark.svg",
    w: 400,
    h: 303,
  },
  wordmark: {
    light: "/brand/logo-wordmark.svg",
    dark: "/brand/logo-wordmark-dark.svg",
    w: 400,
    h: 65,
  },
  "wordmark-wide": {
    light: "/brand/logo-wordmark-wide.svg",
    dark: "/brand/logo-wordmark-wide-dark.svg",
    w: 400,
    h: 58,
  },
} as const;

export function BrandMark({
  variant = "mark",
  height = 32,
  className,
  priority = false,
  themeAware = true,
}: BrandMarkProps) {
  const { light, dark, w, h } = SOURCES[variant];
  const width = Math.round((w / h) * height);
  if (!themeAware) {
    return (
      <Image
        src={light}
        alt="UmlautAdaptarrEX"
        width={width}
        height={height}
        className={cn("select-none", className)}
        unoptimized
        priority={priority}
      />
    );
  }
  return (
    <span
      className={cn("inline-flex shrink-0 select-none", className)}
      style={{ width, height }}
    >
      <Image
        src={light}
        alt="UmlautAdaptarrEX"
        width={width}
        height={height}
        className="block dark:hidden"
        unoptimized
        priority={priority}
      />
      <Image
        src={dark}
        alt=""
        aria-hidden
        width={width}
        height={height}
        className="hidden dark:block"
        unoptimized
        priority={priority}
      />
    </span>
  );
}
