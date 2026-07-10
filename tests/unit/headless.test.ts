import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHeadless } from "@/lib/ports";

const KEY = "UMLAUTADAPTARREX_HEADLESS";

function clearEnv(): void {
  delete process.env[KEY];
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("resolveHeadless", () => {
  it("is false when the variable is unset", () => {
    expect(resolveHeadless()).toBe(false);
  });

  it.each(["1", "true", "yes", "on", "TRUE", "On", " yes "])(
    "is true for affirmative value %j",
    (value) => {
      process.env[KEY] = value;
      expect(resolveHeadless()).toBe(true);
    },
  );

  it.each(["", "0", "false", "no", "off", "  ", "nope"])(
    "is false for non-affirmative value %j",
    (value) => {
      process.env[KEY] = value;
      expect(resolveHeadless()).toBe(false);
    },
  );
});
