// Node-free so it can be imported from client components; the sibling
// @/arr/prowlarr module pulls undici/node:net and must stay server-only.

// Bullet sequence the server uses to indicate "a secret is stored, but we
// won't echo it." The settings schema treats incoming values matching
// `isMaskedSecret` as "leave alone" so a round-trip save keeps the stored
// secret intact.
export const MASKED_SECRET = "••••••••";

export function isMaskedSecret(value: string): boolean {
    if (!value) return false;
    return /^[*•·.]+$/.test(value.trim());
}

export function maskSecret(value: string | null | undefined): string | null {
    if (!value) return value ?? null;
    return MASKED_SECRET;
}
