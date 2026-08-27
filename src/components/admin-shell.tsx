"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  BookOpen,
  Database,
  History,
  Info,
  ListChecks,
  Menu,
  RefreshCw,
  Settings as SettingsIcon,
  Terminal,
} from "lucide-react";
import { type Locale } from "@/lib/i18n-config";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./ui/sheet";
import { BrandMark } from "./brand-mark";
import { ChangelogDialog } from "./changelog-dialog";
import { PauseToggle } from "./pause-toggle";
import { UserMenu } from "./user-menu";

interface NavItem {
  href: string;
  labelKey: keyof Messages;
  icon: React.ComponentType<{ className?: string }>;
}

type Messages = {
  dashboard: string;
  instances: string;
  library: string;
  syncRuns: string;
  requestHistory: string;
  renameHistory: string;
  logs: string;
  settings: string;
  about: string;
};

const NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: Activity },
  { href: "/instances", labelKey: "instances", icon: Database },
  { href: "/library", labelKey: "library", icon: BookOpen },
  { href: "/sync-runs", labelKey: "syncRuns", icon: RefreshCw },
  { href: "/request-history", labelKey: "requestHistory", icon: History },
  { href: "/rename-history", labelKey: "renameHistory", icon: ListChecks },
  { href: "/logs", labelKey: "logs", icon: Terminal },
  { href: "/settings", labelKey: "settings", icon: SettingsIcon },
  { href: "/about", labelKey: "about", icon: Info },
];

export function AdminShell({
  locale,
  username,
  version,
  children,
}: {
  locale: Locale;
  username?: string;
  version?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  const current = NAV.find((item) => pathname.startsWith(item.href));

  return (
    <div className="flex min-h-screen bg-background">
      <ChangelogDialog />
      {/* Skip link - first focusable element on the page, lets keyboard users
          jump past the nav straight to the main content. Hidden until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:ring-2 focus:ring-ring focus:outline-none"
      >
        {t("skipToContent")}
      </a>
      {/* Desktop sidebar - md and up. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <Link
          href="/dashboard"
          className="flex h-20 items-center gap-3 border-b px-5"
          aria-label="UmlautAdaptarrEX"
        >
          <BrandMark variant="mark" height={48} />
          <div className="leading-tight">
            <BrandMark variant="wordmark" height={20} className="opacity-95" />
            <div className="mt-1 text-[11px] tracking-wider text-muted-foreground uppercase">
              Admin
            </div>
          </div>
        </Link>
        <nav className="flex-1 space-y-0.5 p-3" aria-label={t("navLabel")}>
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname.startsWith(item.href)}
              label={t(item.labelKey)}
            />
          ))}
        </nav>
        {version && (
          <div className="border-t px-5 py-3">
            <span className="text-[11px] text-muted-foreground/60">v{version}</span>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {/* Mobile hamburger - opens the nav drawer. */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("openNav")}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0" hideCloseButton>
                <SheetTitle className="sr-only">{t("nav")}</SheetTitle>
                <Link
                  href="/dashboard"
                  className="flex h-16 items-center gap-3 border-b px-5"
                  aria-label="UmlautAdaptarrEX"
                >
                  <BrandMark variant="mark" height={36} />
                  <div className="leading-tight">
                    <BrandMark variant="wordmark" height={16} className="opacity-95" />
                    <div className="mt-1 text-[10px] tracking-wider text-muted-foreground uppercase">
                      Admin
                    </div>
                  </div>
                </Link>
                <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label={t("navLabel")}>
                  {NAV.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      active={pathname.startsWith(item.href)}
                      label={t(item.labelKey)}
                      large
                      onNavigate={closeMobile}
                    />
                  ))}
                </nav>
                {version && (
                  <div className="border-t px-5 py-3">
                    <span className="text-[11px] text-muted-foreground/60">v{version}</span>
                  </div>
                )}
              </SheetContent>
            </Sheet>

            <Link
              href="/dashboard"
              aria-label="UmlautAdaptarrEX"
              className="flex shrink-0 items-center md:hidden"
            >
              <BrandMark variant="mark" height={28} />
            </Link>
            <span className="text-muted-foreground/50 md:hidden">/</span>
            <span className="truncate font-medium">{current ? t(current.labelKey) : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            <PauseToggle />
            <UserMenu locale={locale} username={username} />
          </div>
        </header>
        <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  label,
  large,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  large?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-3 transition-colors",
        large ? "py-2.5 text-sm" : "py-2 text-sm",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span>{label}</span>
    </Link>
  );
}
