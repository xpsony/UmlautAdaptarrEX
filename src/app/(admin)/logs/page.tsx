import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLegacyApiPort } from "@/lib/ports";
import { LogsClient } from "./logs-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("logs");
  return { title: t("title") };
}

export default function LogsPage() {
  // Server component: resolves the effective Fastify port at request time (the
  // Next standalone child inherits UMLAUTADAPTARREX_LEGACYAPI_PORT). Passed to
  // the client so the live-log WebSocket follows a remapped port. A reverse
  // proxy can still override the whole host via NEXT_PUBLIC_API_HOST.
  return <LogsClient apiPort={resolveLegacyApiPort()} />;
}
