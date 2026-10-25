"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/app/_lib/api-client";
import type { IndexerListResponse, IndexerVariationSetting } from "@/schemas/indexer-setting";

const KEY = ["indexer-settings"] as const;

// List the indexers and save one host's setting; `null` resets the host to
// the global switches and caps.
export function useIndexerSettings() {
  const qc = useQueryClient();

  const query = useQuery<IndexerListResponse>({
    queryKey: KEY,
    queryFn: () => apiFetch<IndexerListResponse>("/api/admin/indexers"),
  });

  const save = useMutation({
    mutationFn: ({ host, setting }: { host: string; setting: IndexerVariationSetting | null }) =>
      apiFetch(`/api/admin/indexers/${encodeURIComponent(host)}`, {
        method: setting ? "PUT" : "DELETE",
        ...(setting ? { body: JSON.stringify(setting) } : {}),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });

  return { query, save };
}
