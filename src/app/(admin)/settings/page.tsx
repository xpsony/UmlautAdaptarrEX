import type { Metadata } from "next";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";
import { apiUrl, forwardAuthCookies } from "@/lib/api-upstream";
import { SettingsClient } from "./settings-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

async function serverFetch<T>(path: string, cookieHeader: string): Promise<T> {
  const res = await fetch(apiUrl(path), {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export default async function SettingsPage() {
  const cookieHeader = await forwardAuthCookies();
  const queryClient = new QueryClient();

  // Prefetch the four queries the settings page mounts with. The "settings"
  // key is shared by SettingsRow and OperationModeResponse callsites - one
  // prefetch covers both. Failures are swallowed so a single broken upstream
  // doesn't block render; useQuery on the client will retry.
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: ["settings"],
      queryFn: () => serverFetch("/api/admin/settings", cookieHeader),
    }),
    queryClient.prefetchQuery({
      queryKey: ["prowlarr-config"],
      queryFn: () =>
        serverFetch("/api/admin/instances/prowlarr/config", cookieHeader),
    }),
    queryClient.prefetchQuery({
      queryKey: ["title-cache"],
      queryFn: () => serverFetch("/api/admin/title-cache", cookieHeader),
    }),
    queryClient.prefetchQuery({
      queryKey: ["plugins"],
      queryFn: () => serverFetch("/api/admin/plugins", cookieHeader),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SettingsClient />
    </HydrationBoundary>
  );
}
