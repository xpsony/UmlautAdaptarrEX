"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/app/_lib/api-client";
import type { IndexerListResponse, IndexerSwitches } from "@/schemas/indexer-setting";

const KEY = ["indexer-settings"] as const;

// List the indexers and save one host's switches; `null` resets the host to
// the global switches.
export function useIndexerSettings() {
  const qc = useQueryClient();

  const query = useQuery<IndexerListResponse>({
    queryKey: KEY,
    queryFn: () => apiFetch<IndexerListResponse>("/api/admin/indexers"),
  });

  const save = useMutation({
    mutationFn: ({ host, switches }: { host: string; switches: IndexerSwitches | null }) =>
      apiFetch(`/api/admin/indexers/${encodeURIComponent(host)}`, {
        method: switches ? "PUT" : "DELETE",
        ...(switches ? { body: JSON.stringify(switches) } : {}),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });

  return { query, save };
}
