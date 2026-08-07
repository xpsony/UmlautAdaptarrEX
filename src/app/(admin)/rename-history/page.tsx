import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HistoryPageSkeleton } from "@/components/ui/history-page";
import { RenameHistoryClient } from "./rename-history-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("history.rename");
  return { title: t("title") };
}

export default function RenameHistoryPage() {
  return (
    <Suspense fallback={<HistoryPageSkeleton />}>
      <RenameHistoryClient />
    </Suspense>
  );
}
