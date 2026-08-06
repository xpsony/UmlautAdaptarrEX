import { describe, expect, it } from "vitest";
import { resolveAppVersion } from "@/lib/version";

describe("resolveAppVersion", () => {
  it("uses APP_VERSION when the image was built with the build-arg", () => {
    expect(resolveAppVersion("1.3.0", "1.3.0")).toBe("1.3.0");
    expect(resolveAppVersion("1.3.0-881f830", "1.3.0")).toBe("1.3.0-881f830");
  });

  it("strips a leading v from a release tag, in either case", () => {
    expect(resolveAppVersion("v1.3.0", "1.3.0")).toBe("1.3.0");
    expect(resolveAppVersion("V1.3.0", "1.3.0")).toBe("1.3.0");
  });

  it("falls back to the package version when APP_VERSION is unset", () => {
    expect(resolveAppVersion(undefined, "1.3.0")).toBe("1.3.0");
  });

  it("falls back when APP_VERSION is empty or blank", () => {
    // `docker compose up --build` passes no build-arg, and the Dockerfile's
    // `ENV APP_VERSION=$APP_VERSION` then bakes an empty variable into the
    // image. Without this, the UI rendered a bare "v".
    expect(resolveAppVersion("", "1.3.0")).toBe("1.3.0");
    expect(resolveAppVersion("   ", "1.3.0")).toBe("1.3.0");
  });

  it("never returns an empty string, even without a package version", () => {
    expect(resolveAppVersion("", "")).toBe("unknown");
    expect(resolveAppVersion(undefined, undefined)).toBe("unknown");
  });
});
