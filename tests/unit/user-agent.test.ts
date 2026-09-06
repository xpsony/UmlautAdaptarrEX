import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../package.json";
import {
  defaultUserAgent,
  outboundUserAgent,
  resolveUserAgent,
  USER_AGENT_PRODUCT,
} from "@/lib/user-agent";

const ORIGINAL_APP_VERSION = process.env.APP_VERSION;

afterEach(() => {
  if (ORIGINAL_APP_VERSION === undefined) delete process.env.APP_VERSION;
  else process.env.APP_VERSION = ORIGINAL_APP_VERSION;
});

describe("defaultUserAgent", () => {
  it("tracks the running version instead of a hard-coded literal", () => {
    delete process.env.APP_VERSION;
    expect(defaultUserAgent()).toBe(`${USER_AGENT_PRODUCT}/${pkg.version}`);
    // The literal this replaced claimed 2.0 while the app shipped as 1.x.
    expect(defaultUserAgent()).not.toBe("UmlautAdaptarrEX/2.0");
  });

  it("prefers APP_VERSION, which the release image bakes in", () => {
    process.env.APP_VERSION = "v2.1.0";
    expect(defaultUserAgent()).toBe(`${USER_AGENT_PRODUCT}/2.1.0`);
  });

  it("falls back to package.json when APP_VERSION is baked in empty", () => {
    // The Dockerfile declares ARG/ENV APP_VERSION, so a build without the
    // build-arg bakes in an empty string rather than leaving it unset.
    process.env.APP_VERSION = "";
    expect(defaultUserAgent()).toBe(`${USER_AGENT_PRODUCT}/${pkg.version}`);
  });
});

describe("resolveUserAgent", () => {
  it("treats blank as automatic", () => {
    expect(resolveUserAgent("")).toBe(defaultUserAgent());
    expect(resolveUserAgent("   ")).toBe(defaultUserAgent());
    expect(resolveUserAgent(null)).toBe(defaultUserAgent());
    expect(resolveUserAgent(undefined)).toBe(defaultUserAgent());
  });

  it("uses the operator's override verbatim", () => {
    expect(resolveUserAgent("MyProxy/1.2")).toBe("MyProxy/1.2");
    expect(resolveUserAgent("  MyProxy/1.2  ")).toBe("MyProxy/1.2");
  });
});

describe("outboundUserAgent", () => {
  const own = "UmlautAdaptarrEX/1.4.0";

  it("sends only our own token when forwarding is off (the default)", () => {
    expect(outboundUserAgent("Sonarr/4.0.0.748 (docker)", own, false)).toBe(own);
  });

  it("forwards the *Arr header verbatim when forwarding is on", () => {
    expect(outboundUserAgent("Sonarr/4.0.0.748 (docker)", own, true)).toBe(
      "Sonarr/4.0.0.748 (docker)",
    );
  });

  it("never concatenates the two", () => {
    // The previous behaviour produced "Sonarr/4 UmlautAdaptarrEX/2.0", a value
    // that identifies neither client and defeats indexer UA allow-lists.
    for (const forward of [true, false]) {
      const result = outboundUserAgent("Sonarr/4", own, forward);
      expect(result).not.toContain(" UmlautAdaptarrEX/1.4.0");
      expect(result === "Sonarr/4" || result === own).toBe(true);
    }
  });

  it("falls back to ours when the *Arr sent nothing", () => {
    expect(outboundUserAgent(undefined, own, true)).toBe(own);
    expect(outboundUserAgent(null, own, true)).toBe(own);
    expect(outboundUserAgent("", own, true)).toBe(own);
    expect(outboundUserAgent("   ", own, true)).toBe(own);
  });
});
