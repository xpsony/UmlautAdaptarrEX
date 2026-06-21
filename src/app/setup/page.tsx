import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleToggle } from "@/components/locale-toggle";
import { DEFAULT_LOCALE, isSupportedLocale } from "@/lib/i18n-config";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import { apiUrl, forwardAuthCookies } from "@/lib/api-upstream";
import type { SetupStatus } from "./_lib/setup-wizard";
import { SetupClient } from "./setup-client";

const FALLBACK_STATUS: SetupStatus = {
  setupComplete: false,
  prowlarrConfig: { host: null, configured: false },
  proxyDefaults: { port: 5006, username: "UmlautAdaptarr", portEnvManaged: false },
  legacyApiPort: 5005,
};

async function fetchSetupStatus(): Promise<SetupStatus | null> {
  const cookieHeader = await forwardAuthCookies();
  try {
    const res = await fetch(apiUrl("/api/auth/setup-status"), {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as SetupStatus;
  } catch {
    return null;
  }
}

export default async function SetupPage() {
  const status = await fetchSetupStatus();
  if (status?.setupComplete) redirect("/dashboard");

  const t = await getTranslations("setup");
  const locale = await getLocale();
  const safeLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;

  // Upstream unreachable: render the wizard with sane defaults so the user
  // can still kick off setup; the first real API call will surface the issue.
  const initialStatus = status ?? FALLBACK_STATUS;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandMark variant="mark" height={48} priority />
          <div>
            <BrandMark variant="wordmark" height={16} className="mb-1" />
            <div className="text-xs text-muted-foreground">{t("title")}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <LocaleToggle current={safeLocale} />
        </div>
      </header>

      <p className="mb-8 text-muted-foreground">{t("intro")}</p>

      <SetupClient initialStatus={initialStatus} />
    </main>
  );
}
