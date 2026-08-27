/**
 * Resolves the version string shown in the Web UI.
 *
 * `APP_VERSION` is baked into the Docker image at build time (release.yml
 * passes the release tag). It cannot simply be null-checked: the Dockerfile
 * declares `ARG APP_VERSION` and `ENV APP_VERSION=$APP_VERSION`, so a build
 * without the build-arg (`docker compose up --build`, a plain `docker build .`)
 * still bakes an *empty* variable into the image. A nullish check would keep
 * that empty string and the UI would render a bare "v", so anything blank has
 * to fall back to the version from package.json as well.
 *
 * A leading "v" is stripped because the UI renders its own "v" prefix and
 * release tags may or may not carry one.
 */
export function resolveAppVersion(
  rawVersion: string | undefined,
  packageVersion: string | undefined,
): string {
  const fromEnv = rawVersion?.trim();
  const fromPackage = packageVersion?.trim();
  const version = (fromEnv || fromPackage || "unknown").replace(/^v/i, "");
  return version || "unknown";
}

// `<release>-dev-<short sha>`, the shape the dev-image workflow bakes in.
// Anchored on `dev-` so that a prerelease tag ("2.0.0-rc1") keeps rendering
// as one string.
const DEV_VERSION_RE = /^(\d+\.\d+\.\d+)-(dev-[0-9a-f]{7,40})$/i;

/**
 * The version label for the UI, "v" prefix included.
 *
 * `APP_VERSION` stays ONE token even for a dev build, because the same string
 * goes into the outbound User-Agent (`UmlautAdaptarrEX/<version>`) where a
 * space would be invalid. Only the display splits the channel off and
 * upper-cases it: `1.4.0-dev-6a0974e` renders as "v1.4.0 DEV-6A0974E", so a
 * dev image says which release it is built on instead of naming only its
 * commit. Everything else - a release tag, a security rebuild, `ci-smoke` -
 * is returned unchanged behind the "v".
 */
export function formatAppVersionLabel(version: string): string {
  const match = DEV_VERSION_RE.exec(version);
  if (!match) return `v${version}`;
  return `v${match[1]} ${match[2]!.toUpperCase()}`;
}
