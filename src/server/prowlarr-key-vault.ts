import { nanoid } from "nanoid";

// Server-side token vault for downstream-app API keys returned by the
// `/api/auth/prowlarr/preview` endpoint. The wire response replaces every
// real key with an opaque `__ua_key:…` token; on setup submission the route
// resolves the token back to the real key without ever shipping it to the
// browser.
//
// In-memory only - entries auto-expire after 15 minutes so a leaked browser
// snapshot can't be replayed forever, and the map is bounded so a flood of
// preview calls can't OOM the process.

const TOKEN_PREFIX = "__ua_key:";
const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 1024;

interface VaultEntry {
  apiKey: string;
  expiresAt: number;
}

const vault = new Map<string, VaultEntry>();

function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of vault) {
    if (entry.expiresAt <= now) vault.delete(key);
  }
  // Hard cap - drop oldest if still over.
  if (vault.size > MAX_ENTRIES) {
    const overflow = vault.size - MAX_ENTRIES;
    const it = vault.keys();
    for (let i = 0; i < overflow; i++) {
      const next = it.next();
      if (next.done) break;
      vault.delete(next.value);
    }
  }
}

export function isVaultToken(s: string): boolean {
  return s.startsWith(TOKEN_PREFIX);
}

export function storeApiKey(apiKey: string): string {
  sweep();
  const token = `${TOKEN_PREFIX}${nanoid(24)}`;
  vault.set(token, { apiKey, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function resolveVaultToken(token: string): string | null {
  sweep();
  const entry = vault.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    vault.delete(token);
    return null;
  }
  return entry.apiKey;
}

// Test-only utility - clear the vault between tests.
export function _clearVaultForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("vault clear must not be called in production");
  }
  vault.clear();
}
