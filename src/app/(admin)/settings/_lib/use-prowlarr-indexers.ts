"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/app/_lib/api-client";
import type {
  PatchIndexersInput,
  PatchIndexersResponse,
  ProwlarrIndexersResponse,
} from "@/schemas/prowlarr";

// Query the indexer list + run the reconcile mutation. `open` gates the query
// so the dialog only hits Prowlarr while it is visible.
export function useProwlarrIndexers(open: boolean) {
  const qc = useQueryClient();

  const query = useQuery<ProwlarrIndexersResponse>({
    queryKey: ["prowlarr-indexers"],
    queryFn: () => apiFetch<ProwlarrIndexersResponse>("/api/admin/instances/prowlarr/indexers"),
    enabled: open,
    staleTime: 0,
  });

  const patchMut = useMutation({
    mutationFn: (selection: PatchIndexersInput) =>
      apiFetch<PatchIndexersResponse>("/api/admin/instances/prowlarr/indexers/patch", {
        method: "POST",
        body: JSON.stringify(selection),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["prowlarr-indexers"] }),
  });

  return { query, patchMut };
}
