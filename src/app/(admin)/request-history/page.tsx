import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HistoryPageSkeleton } from "@/components/ui/history-page";
import { RequestHistoryClient } from "./request-history-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("history.request");
  return { title: t("title") };
}

export default function RequestHistoryPage() {
  return (
    <Suspense fallback={<HistoryPageSkeleton />}>
      <RequestHistoryClient />
    </Suspense>
  );
}
