import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {HostRateLimiter, parseRetryAfterMs,} from "@/server/proxy/rate-limiter.js";

describe("parseRetryAfterMs", () => {
    it("parses delta-seconds form", () => {
        expect(parseRetryAfterMs("30")).toBe(30_000);
        expect(parseRetryAfterMs("0")).toBe(0);
    });

    it("parses HTTP-date form (positive diff to now)", () => {
        const now = Date.now();
        const target = now + 90_000;
        const date = new Date(target).toUTCString();
        const got = parseRetryAfterMs(date, now);
        // Allow 1s tolerance for header second-precision rounding.
        expect(got).toBeGreaterThanOrEqual(89_000);
        expect(got).toBeLessThanOrEqual(91_000);
    });

    it("returns 0 for missing/empty header", () => {
        expect(parseRetryAfterMs(undefined)).toBe(0);
        expect(parseRetryAfterMs("")).toBe(0);
        expect(parseRetryAfterMs("  ")).toBe(0);
    });

    it("returns 0 for unparseable header", () => {
        expect(parseRetryAfterMs("not-a-date")).toBe(0);
    });

    it("caps at 5 minutes (sanity guard)", () => {
        expect(parseRetryAfterMs("3600")).toBe(5 * 60_000);
    });

    it("clamps past dates to 0", () => {
        const now = Date.now();
        const past = new Date(now - 60_000).toUTCString();
        expect(parseRetryAfterMs(past, now)).toBe(0);
    });

    it("uses first value of an array header", () => {
        expect(parseRetryAfterMs(["10", "30"])).toBe(10_000);
    });
});

describe("HostRateLimiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("baseline spacing comes from the live getter (no restart needed)", async () => {
        let interval = 1000;
        const lim = new HostRateLimiter(() => interval);

        await lim.wait("a.example");
        // Second call would normally need to wait `interval` (1000ms).
        let resolved = false;
        void lim.wait("a.example").then(() => {
            resolved = true;
        });
        await vi.advanceTimersByTimeAsync(500);
        expect(resolved).toBe(false);
        await vi.advanceTimersByTimeAsync(500);
        expect(resolved).toBe(true);

        // Drop the interval - the next call should pass through immediately.
        interval = 0;
        const start = Date.now();
        await lim.wait("a.example");
        expect(Date.now() - start).toBe(0);
    });

    it("does not block across distinct hosts", async () => {
        const lim = new HostRateLimiter(() => 1000);
        await lim.wait("a.example");
        const start = Date.now();
        await lim.wait("b.example");
        expect(Date.now() - start).toBe(0);
    });

    it("backoff() extends the next-allowed window beyond baseline", async () => {
        const lim = new HostRateLimiter(() => 100);
        await lim.wait("a.example");
        // Baseline would unblock at +100ms; backoff pushes to +5000ms.
        lim.backoff("a.example", Date.now() + 5000);

        let resolved = false;
        void lim.wait("a.example").then(() => {
            resolved = true;
        });
        await vi.advanceTimersByTimeAsync(2000);
        expect(resolved).toBe(false);
        await vi.advanceTimersByTimeAsync(3000);
        expect(resolved).toBe(true);
    });

    it("backoff() never shortens an existing longer window", () => {
        const lim = new HostRateLimiter(() => 0);
        const long = Date.now() + 10_000;
        lim.backoff("a.example", long);
        lim.backoff("a.example", Date.now() + 1000); // shorter - must be ignored
        // Internal state isn't observable, so verify via behavior.
        let resolved = false;
        void lim.wait("a.example").then(() => {
            resolved = true;
        });
        void vi.advanceTimersByTimeAsync(2000).then(() => {
            expect(resolved).toBe(false);
        });
    });
});
