import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLegacyApiPort, resolveProxyPortEnv, resolveWebUiPort } from "@/lib/ports";

const KEYS = [
  "UMLAUTADAPTARREX_LEGACYAPI_PORT",
  "UMLAUTADAPTARREX_WEBUI_PORT",
  "UMLAUTADAPTARREX_PROXY_PORT",
] as const;

function clearEnv(): void {
  for (const k of KEYS) delete process.env[k];
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("resolveLegacyApiPort", () => {
  it("defaults to 5005 when nothing is set", () => {
    expect(resolveLegacyApiPort()).toBe(5005);
  });

  it("uses the branded var when set", () => {
    process.env.UMLAUTADAPTARREX_LEGACYAPI_PORT = "7005";
    expect(resolveLegacyApiPort()).toBe(7005);
  });

  it("treats an empty branded var as unset and falls back to the default", () => {
    process.env.UMLAUTADAPTARREX_LEGACYAPI_PORT = "";
    expect(resolveLegacyApiPort()).toBe(5005);
  });

  it("throws on a non-numeric value", () => {
    process.env.UMLAUTADAPTARREX_LEGACYAPI_PORT = "abc";
    expect(() => resolveLegacyApiPort()).toThrow(/integer between 1024 and 65535/);
  });

  it("throws on an out-of-range value", () => {
    process.env.UMLAUTADAPTARREX_LEGACYAPI_PORT = "80";
    expect(() => resolveLegacyApiPort()).toThrow();
  });

  it("throws on a non-integer value", () => {
    process.env.UMLAUTADAPTARREX_LEGACYAPI_PORT = "70.5";
    expect(() => resolveLegacyApiPort()).toThrow();
  });
});

describe("resolveWebUiPort", () => {
  it("defaults to 5007", () => {
    expect(resolveWebUiPort()).toBe(5007);
  });

  it("uses the branded var when set", () => {
    process.env.UMLAUTADAPTARREX_WEBUI_PORT = "7007";
    expect(resolveWebUiPort()).toBe(7007);
  });

  it("treats an empty branded var as unset and falls back to the default", () => {
    process.env.UMLAUTADAPTARREX_WEBUI_PORT = "";
    expect(resolveWebUiPort()).toBe(5007);
  });

  it("throws on an invalid branded var", () => {
    process.env.UMLAUTADAPTARREX_WEBUI_PORT = "abc";
    expect(() => resolveWebUiPort()).toThrow();
  });
});

describe("resolveProxyPortEnv", () => {
  it("returns null when unset (caller falls back to the DB value)", () => {
    expect(resolveProxyPortEnv()).toBeNull();
  });

  it("returns the parsed branded value when set", () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "6006";
    expect(resolveProxyPortEnv()).toBe(6006);
  });

  it("throws on garbage", () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "nope";
    expect(() => resolveProxyPortEnv()).toThrow();
  });

  it("treats a whitespace-only value as unset", () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "   ";
    expect(resolveProxyPortEnv()).toBeNull();
  });
});

describe("strict decimal parsing", () => {
  it("rejects a hex string", () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "0x1F90";
    expect(() => resolveProxyPortEnv()).toThrow();
  });

  it("rejects a float literal", () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "5005.0";
    expect(() => resolveProxyPortEnv()).toThrow();
  });

  it("rejects a value with a leading plus sign", () => {
    process.env.UMLAUTADAPTARREX_PROXY_PORT = "+5005";
    expect(() => resolveProxyPortEnv()).toThrow();
  });
});
