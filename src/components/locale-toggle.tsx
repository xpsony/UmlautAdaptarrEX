"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { LOCALE_COOKIE, LOCALE_INFO, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n-config";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function LocaleToggle({ current }: { current: Locale }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeLocale(next: string): void {
    if (next === current) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
    // router.refresh() re-runs the server layout/page tree (getLocale/getMessages
    // in the root layout read the cookie fresh), swapping next-intl messages
    // without a full page reload - client state elsewhere on the page survives.
    startTransition(() => {
      router.refresh();
    });
  }

  const info = LOCALE_INFO[current];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`${t("language")}: ${info.label}`}
          className="gap-2"
        >
          <Languages className="h-4 w-4" />
          <span className="text-base leading-none" aria-hidden="true">
            {info.flag}
          </span>
          <span className="text-xs font-medium tracking-wide uppercase">{current}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup value={current} onValueChange={changeLocale}>
          {SUPPORTED_LOCALES.map((code) => (
            <DropdownMenuRadioItem key={code} value={code}>
              <span className="flex items-center gap-2">
                <span aria-hidden="true">{LOCALE_INFO[code].flag}</span>
                {LOCALE_INFO[code].label}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
