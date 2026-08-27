"use client";

import { useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Languages, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import {
  LOCALE_COOKIE,
  LOCALE_INFO,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type Locale,
} from "@/lib/i18n-config";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const subscribe = () => () => {};

export function UserMenu({ locale, username }: { locale: Locale; username?: string | undefined }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  // SSR liefert false -> Icon stabil, Hydration-flicker vermieden.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [, startTransition] = useTransition();

  const currentTheme = mounted ? (theme ?? "system") : "system";
  const ThemeIcon = currentTheme === "dark" ? Moon : currentTheme === "system" ? Monitor : Sun;

  function changeLocale(next: string): void {
    if (!isSupportedLocale(next)) return;
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
    // router.refresh() re-runs the server layout/page tree (getLocale/getMessages
    // in the root layout read the cookie fresh), swapping next-intl messages
    // without a full page reload - client state elsewhere on the page survives.
    startTransition(() => {
      router.refresh();
    });
  }

  async function logout(): Promise<void> {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  const initial = (username?.trim()?.[0] ?? "U").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-9 gap-2 rounded-full pr-3 pl-1 hover:bg-accent",
            "data-[state=open]:bg-accent",
          )}
          aria-label={username ?? "User menu"}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground uppercase"
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className="hidden text-sm font-medium sm:inline">{username ?? ""}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <ThemeIcon className="h-4 w-4" suppressHydrationWarning />
            <span>{t("theme")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuRadioGroup value={currentTheme} onValueChange={(v) => setTheme(v)}>
                <DropdownMenuRadioItem value="light">
                  <span className="flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    {t("themeLight")}
                  </span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <span className="flex items-center gap-2">
                    <Moon className="h-4 w-4" />
                    {t("themeDark")}
                  </span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <span className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    {t("themeSystem")}
                  </span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Languages className="h-4 w-4" />
            <span>{t("language")}</span>
            <span className="ml-auto text-base leading-none" aria-hidden="true">
              {LOCALE_INFO[locale].flag}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuRadioGroup value={locale} onValueChange={changeLocale}>
                {SUPPORTED_LOCALES.map((code) => (
                  <DropdownMenuRadioItem key={code} value={code}>
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true">{LOCALE_INFO[code].flag}</span>
                      {LOCALE_INFO[code].label}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
