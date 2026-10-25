import type { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { PatchIndexersResponse } from "@/schemas/prowlarr";

// Shared by the settings dialog and the setup-wizard step, so a failed indexer
// is named in both places instead of disappearing behind a generic success.
// `t` must be scoped to "settings.prowlarr".
export function toastPatchResult(
  t: ReturnType<typeof useTranslations>,
  res: PatchIndexersResponse,
): void {
  const count = (a: string): number => res.results.filter((r) => r.action === a).length;
  toast.success(
    t("patchResult", {
      patched: count("patched"),
      unpatched: count("unpatched"),
      unchanged: count("unchanged"),
      skipped: count("skipped"),
      failed: count("failed"),
    }),
  );
  const detached = res.results.filter((r) => r.detached).length;
  if (detached > 0) toast.success(t("patchResultDetached", { count: detached }));
  const failed = res.results.filter((r) => r.action === "failed");
  if (failed.length > 0) {
    toast.error(
      t("patchResultFailedDetail", {
        names: failed.map((f) => f.name).join(", "),
      }),
    );
  }
}
