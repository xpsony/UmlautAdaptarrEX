import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { AdminShell } from "@/components/admin-shell";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale } from "@/lib/i18n-config";
import { apiUrl, forwardAuthCookies } from "@/lib/api-upstream";
import { resolveAppVersion } from "@/lib/version";
import pkg from "../../../package.json";

async function fetchMe(): Promise<{ id: string; username: string } | null> {
  const cookieHeader = await forwardAuthCookies();
  const res = await fetch(apiUrl("/api/auth/me"), {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string; username: string };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await fetchMe();
  if (!me) {
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? "";
    const next =
      pathname.startsWith("/") && !pathname.startsWith("//")
        ? `&next=${encodeURIComponent(pathname)}`
        : "";
    redirect(`/login?expired=1${next}`);
  }

  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isSupportedLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE;

  const version = resolveAppVersion(process.env.APP_VERSION, pkg.version);

  return (
    <AdminShell locale={locale} username={me.username} version={version}>
      {children}
    </AdminShell>
  );
}
