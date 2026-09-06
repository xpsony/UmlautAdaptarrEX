import { describe, expect, it } from "vitest";
import { formatAppVersionLabel, resolveAppVersion } from "@/lib/version";

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

describe("formatAppVersionLabel", () => {
  it("splits a dev build into release + channel", () => {
    // What the dev-image workflow bakes in, and what the UI has to show: the
    // release the build is based on, then the commit. Before this it rendered
    // as "vDEV-6a0974e" and named no release at all.
    expect(formatAppVersionLabel("1.4.0-dev-6a0974e")).toBe("v1.4.0 DEV-6A0974E");
  });

  it("accepts a full-length sha", () => {
    expect(formatAppVersionLabel("1.4.0-dev-6a0974e1b2c3d4e5f60718293a4b5c6d7e8f90a")).toBe(
      "v1.4.0 DEV-6A0974E1B2C3D4E5F60718293A4B5C6D7E8F90A",
    );
  });

  it("leaves a release version alone", () => {
    expect(formatAppVersionLabel("1.4.0")).toBe("v1.4.0");
  });

  it("leaves a prerelease tag as one string", () => {
    // Only the dev channel is split; "rc1" is part of the version itself.
    expect(formatAppVersionLabel("2.0.0-rc1")).toBe("v2.0.0-rc1");
  });

  it("leaves a security rebuild's version alone", () => {
    // Regression guard: the rebuild ships the plain release tag on purpose, so
    // there is nothing to split here (see the version-display fix in 1.4.0).
    expect(formatAppVersionLabel("1.4.0")).toBe("v1.4.0");
    expect(formatAppVersionLabel("ci-smoke")).toBe("vci-smoke");
    expect(formatAppVersionLabel("unknown")).toBe("vunknown");
  });

  it("composes with resolveAppVersion, leading v and all", () => {
    expect(formatAppVersionLabel(resolveAppVersion("v1.4.0-dev-6a0974e", "1.4.0"))).toBe(
      "v1.4.0 DEV-6A0974E",
    );
  });
});
