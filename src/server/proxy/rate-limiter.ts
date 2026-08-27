// Per-host rate limiter for upstream indexer fetches. Two coordinated knobs:
//   1. baseline spacing - `minIntervalMsGetter()`, read live from Settings
//      so admin-UI changes apply without restart.
//   2. dynamic backoff   - `backoff(host, untilMs)` extends the next-allowed
//      window when an indexer returns 429/503 with `Retry-After`.

export class HostRateLimiter {
    /** Last issued fetch per host (epoch ms). Drives the baseline spacing. */
    private readonly lastFetch = new Map<string, number>();
    /** Explicit "do not call before" timestamp per host (epoch ms). */
    private readonly nextAllowedAt = new Map<string, number>();

    constructor(private readonly minIntervalMsGetter: () => number) {
    }

    async wait(host: string): Promise<void> {
        const minInterval = Math.max(0, this.minIntervalMsGetter());
        const now = Date.now();
        const baselineNext = (this.lastFetch.get(host) ?? 0) + minInterval;
        const explicitNext = this.nextAllowedAt.get(host) ?? 0;
        const next = Math.max(baselineNext, explicitNext);
        if (next > now) {
            await new Promise((r) => setTimeout(r, next - now));
        }
        this.lastFetch.set(host, Date.now());
        // Once the explicit backoff has elapsed, drop it so the limiter falls back
        // to baseline spacing - keeping the map from growing unbounded.
        if (explicitNext > 0 && explicitNext <= Date.now()) {
            this.nextAllowedAt.delete(host);
        }
    }

    /**
     * Apply (or extend) a backoff window: don't issue another fetch to `host`
     * before `untilMs` (epoch). No-op if the existing backoff is already later.
     */
    backoff(host: string, untilMs: number): void {
        const current = this.nextAllowedAt.get(host) ?? 0;
        if (untilMs > current) this.nextAllowedAt.set(host, untilMs);
    }
}

/**
 * Parse an HTTP `Retry-After` header into milliseconds. Accepts both forms:
 *   - delta-seconds (`"30"`) → `30 * 1000`
 *   - HTTP-date    (`"Wed, 21 Oct 2026 07:28:00 GMT"`) → diff to now
 * Returns 0 if the header is missing or unparseable. Caps at 5 minutes to
 * avoid pathological backoff in case of misbehaving indexers.
 */
export function parseRetryAfterMs(
    header: string | string[] | undefined,
    now: number = Date.now(),
): number {
    if (!header) return 0;
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) return 0;
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const MAX = 5 * 60_000;
    // Numeric seconds - delta-seconds form per RFC 7231.
    if (/^\d+$/.test(trimmed)) {
        return Math.min(MAX, parseInt(trimmed, 10) * 1000);
    }
    // HTTP-date form.
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return 0;
    return Math.max(0, Math.min(MAX, date - now));
}
