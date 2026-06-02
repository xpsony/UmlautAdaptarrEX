import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { isOriginAllowed } from "@/server/logging/broadcast";

const KEYS = ["UMLAUTADAPTARREX_WEBUI_PORT", "WEB_PORT"] as const;

function clearEnv(): void {
  for (const k of KEYS) delete process.env[k];
}

beforeEach(clearEnv);
afterEach(clearEnv);

function req(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("isOriginAllowed", () => {
  it("accepts a missing Origin (non-browser client)", () => {
    expect(isOriginAllowed(req({ host: "example:5005" }))).toBe(true);
  });

  it("accepts same-origin", () => {
    expect(isOriginAllowed(req({ host: "example:5005", origin: "http://example:5005" }))).toBe(
      true,
    );
  });

  it("accepts the default Web UI port (5007) on the same hostname", () => {
    expect(isOriginAllowed(req({ host: "example:5005", origin: "http://example:5007" }))).toBe(
      true,
    );
  });

  it("accepts a remapped Web UI port from UMLAUTADAPTARREX_WEBUI_PORT", () => {
    process.env.UMLAUTADAPTARREX_WEBUI_PORT = "7007";
    expect(isOriginAllowed(req({ host: "example:6005", origin: "http://example:7007" }))).toBe(
      true,
    );
  });

  it("rejects a foreign port", () => {
    expect(isOriginAllowed(req({ host: "example:5005", origin: "http://example:9999" }))).toBe(
      false,
    );
  });

  it("rejects a different hostname", () => {
    expect(isOriginAllowed(req({ host: "example:5005", origin: "http://evil:5007" }))).toBe(false);
  });
});
