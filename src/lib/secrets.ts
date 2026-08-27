// Node-free so it can be imported from client components; the sibling
// @/arr/prowlarr module pulls undici/node:net and must stay server-only.

// Bullet sequence the server uses to indicate "a secret is stored, but we
// won't echo it." The settings schema treats incoming values matching
// `isMaskedSecret` as "leave alone" so a round-trip save keeps the stored
// secret intact.
export const MASKED_SECRET = "••••••••";

export function isMaskedSecret(value: string): boolean {
    if (!value) return false;
    const trimmed = value.trim();
    // Recognize two masking conventions: our own bullet/middot sentinel
    // (MASKED_SECRET) and Prowlarr's asterisk masking (e.g. "********"), which
    // the Prowlarr import / test-connection paths rely on. The literal dot `.`
    // is deliberately excluded - it is not used as a mask anywhere, so a
    // legitimate dot-containing secret is never mistaken for the mask and
    // silently dropped on a settings round-trip.
    if (trimmed === MASKED_SECRET) return true;
    return /^[•·*]+$/.test(trimmed);
}

export function maskSecret(value: string | null | undefined): string | null {
    if (!value) return value ?? null;
    return MASKED_SECRET;
}
