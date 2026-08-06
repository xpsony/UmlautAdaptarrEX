/**
 * Badge-variant mapping shared by the admin views that render a status
 * column: sync runs (string status from `SyncRun.status`) and request
 * history (numeric HTTP status code). The two domains are deliberately kept
 * as separate functions rather than merged — they classify different value
 * spaces and happen to only share their output type.
 */

type StatusBadgeVariant = "success" | "warning" | "destructive" | "muted";

/** Maps a sync-run status string (`"ok"`, `"running"`, `"error"`, ...) to a Badge variant. */
export function syncStatusVariant(status: string): StatusBadgeVariant {
  switch (status.toLowerCase()) {
    case "ok":
    case "success":
    case "completed":
      return "success";
    case "running":
    case "queued":
    case "pending":
      return "warning";
    case "failed":
    case "error":
      return "destructive";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "muted";
    default:
      return "muted";
  }
}

/** Maps an HTTP status code to a Badge variant (2xx success, 4xx warning, 5xx destructive). */
export function httpStatusVariant(status: number): StatusBadgeVariant {
  if (status >= 500) return "destructive";
  if (status >= 400) return "warning";
  if (status >= 200 && status < 300) return "success";
  return "muted";
}
