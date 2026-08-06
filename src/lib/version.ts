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
