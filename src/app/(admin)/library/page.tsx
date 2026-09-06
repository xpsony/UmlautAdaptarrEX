import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HistoryPageSkeleton } from "@/components/ui/history-page";
import { LibraryClient } from "./library-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("title") };
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<HistoryPageSkeleton />}>
      <LibraryClient />
    </Suspense>
  );
}
