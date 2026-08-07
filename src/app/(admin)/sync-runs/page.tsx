import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HistoryPageSkeleton } from "@/components/ui/history-page";
import { SyncRunsClient } from "./sync-runs-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("syncRuns");
  return { title: t("title") };
}

export default function SyncRunsPage() {
  return (
    <Suspense fallback={<HistoryPageSkeleton />}>
      <SyncRunsClient />
    </Suspense>
  );
}
