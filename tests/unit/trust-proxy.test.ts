import { describe, expect, it } from "vitest";
import { isHopCountTrustProxy, parseTrustProxy } from "@/server/trust-proxy";

describe("parseTrustProxy", () => {
  it("defaults to 'loopback' when the env var is unset", () => {
    expect(parseTrustProxy(undefined)).toBe("loopback");
  });

  it("returns false for an empty string or 'false'", () => {
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("   ")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
  });

  it("returns true for 'true'", () => {
    expect(parseTrustProxy("true")).toBe(true);
  });

  // Fastify 5.12 disabled hop-count trust (it cannot validate the immediate
  // peer). We fail closed instead of silently widening the trust window.
  it("returns false for an integer string (hop counts are unsupported)", () => {
    expect(parseTrustProxy("1")).toBe(false);
    expect(parseTrustProxy("3")).toBe(false);
    expect(parseTrustProxy(" 2 ")).toBe(false);
  });

  it("returns a trimmed string array for a comma-separated list", () => {
    expect(parseTrustProxy("127.0.0.1, ::1, 10.0.0.0/8")).toEqual([
      "127.0.0.1",
      "::1",
      "10.0.0.0/8",
    ]);
  });

  it("returns the verbatim string for unrecognised values", () => {
    expect(parseTrustProxy("uniquelocal")).toBe("uniquelocal");
    expect(parseTrustProxy("127.0.0.1")).toBe("127.0.0.1");
  });

  it("trims whitespace from the input", () => {
    expect(parseTrustProxy("  loopback  ")).toBe("loopback");
  });
});

describe("isHopCountTrustProxy", () => {
  it("detects the removed hop-count form so the caller can warn", () => {
    expect(isHopCountTrustProxy("1")).toBe(true);
    expect(isHopCountTrustProxy("  10  ")).toBe(true);
  });

  it("is false for every still-supported form", () => {
    expect(isHopCountTrustProxy(undefined)).toBe(false);
    expect(isHopCountTrustProxy("")).toBe(false);
    expect(isHopCountTrustProxy("true")).toBe(false);
    expect(isHopCountTrustProxy("loopback")).toBe(false);
    expect(isHopCountTrustProxy("127.0.0.1")).toBe(false);
  });
});
