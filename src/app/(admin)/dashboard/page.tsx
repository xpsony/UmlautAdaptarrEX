import type { Metadata } from "next";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { getTranslations } from "next-intl/server";
import { apiUrl, forwardAuthCookies } from "@/lib/api-upstream";
import { DashboardClient } from "./dashboard-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
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

export default async function DashboardPage() {
  const cookieHeader = await forwardAuthCookies();
  const queryClient = new QueryClient();

  // Prefetch the four queries the dashboard mounts with. Failures are
  // swallowed individually so a single broken upstream doesn't block the
  // page render - useQuery on the client will retry.
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: ["instances"],
      queryFn: () => serverFetch("/api/admin/instances", cookieHeader),
    }),
    queryClient.prefetchQuery({
      queryKey: ["sync-runs"],
      queryFn: () => serverFetch("/api/admin/sync-runs?take=8", cookieHeader),
    }),
    queryClient.prefetchQuery({
      queryKey: ["dashboard-stats"],
      queryFn: () => serverFetch("/api/admin/stats", cookieHeader),
    }),
    queryClient.prefetchQuery({
      queryKey: ["prowlarr-config"],
      queryFn: () =>
        serverFetch("/api/admin/instances/prowlarr/config", cookieHeader),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}
