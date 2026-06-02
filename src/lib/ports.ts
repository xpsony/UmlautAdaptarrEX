// Single source of truth for resolving the three service ports from the
// environment. Reads `process.env` at call time (not module load) so tests can
// vary the environment. The branded `UMLAUTADAPTARREX_*` names take precedence
// over the historical `PORT` / `WEB_PORT` names; both fall back to the legacy
// defaults.
//
// NOTE: `start.mjs` (the plain-.mjs supervisor) mirrors the LEGACYAPI / WEBUI
// precedence inline because it runs before the TS build is importable. Keep the
// two in sync.

const MIN_PORT = 1024;
const MAX_PORT = 65535;

// Returns the parsed port, or null when the variable is unset/empty (so the
// caller can fall through to the next source). Throws on a present-but-invalid
// value so a misconfiguration fails fast at boot instead of silently binding a
// surprising port.
function parsePort(raw: string | undefined, varName: string): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${varName} must be an integer between ${MIN_PORT} and ${MAX_PORT}, got "${raw}"`,
    );
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < MIN_PORT || n > MAX_PORT) {
    throw new Error(
      `${varName} must be an integer between ${MIN_PORT} and ${MAX_PORT}, got "${raw}"`,
    );
  }
  return n;
}

export function resolveLegacyApiPort(): number {
  return (
    parsePort(process.env.UMLAUTADAPTARREX_LEGACYAPI_PORT, "UMLAUTADAPTARREX_LEGACYAPI_PORT") ??
    parsePort(process.env.PORT, "PORT") ??
    5005
  );
}

export function resolveWebUiPort(): number {
  return (
    parsePort(process.env.UMLAUTADAPTARREX_WEBUI_PORT, "UMLAUTADAPTARREX_WEBUI_PORT") ??
    parsePort(process.env.WEB_PORT, "WEB_PORT") ??
    5007
  );
}

// Null means "no env override"; callers fall back to the persisted DB value.
export function resolveProxyPortEnv(): number | null {
  return parsePort(process.env.UMLAUTADAPTARREX_PROXY_PORT, "UMLAUTADAPTARREX_PROXY_PORT");
}
