// The repo manifest is not one of the layers `no-restricted-imports` guards,
// and there is no @/* alias for a file outside src/ - src/app/(admin)/about
// reads the version the same way (that path is exempt from the rule wholesale).
// eslint-disable-next-line no-restricted-imports
import pkg from "../../package.json";
import { resolveAppVersion } from "./version";

/**
 * The product token we identify ourselves with. Kept separate from the
 * version so log/UI copy and the migration can reason about the prefix.
 */
export const USER_AGENT_PRODUCT = "UmlautAdaptarrEX";

/**
 * The User-Agent used when the operator has not overridden it: our product
 * token plus the running version, resolved exactly like the version shown in
 * the Web UI (`APP_VERSION` baked into the image, falling back to
 * package.json). Previously this was the string literal
 * `UmlautAdaptarrEX/2.0`, hard-coded in three places and stale ever since the
 * 2.0 rewrite shipped as 1.x.
 */
export function defaultUserAgent(): string {
  return `${USER_AGENT_PRODUCT}/${resolveAppVersion(process.env.APP_VERSION, pkg.version)}`;
}

/**
 * The effective User-Agent for outbound requests. A blank `Setting.userAgent`
 * means "auto" - the column carries an *override*, not the value itself, so
 * the version tracks releases without the operator having to edit it.
 */
export function resolveUserAgent(configured: string | null | undefined): string {
  const override = configured?.trim();
  return override || defaultUserAgent();
}

/**
 * Composes the User-Agent for one outbound indexer request.
 *
 * `forwardArrUserAgent` off (the default) sends only our own token: the
 * indexer sees a stable, honest identifier and no Sonarr/Radarr version
 * fingerprint. On, the calling *Arr's header is forwarded verbatim, which is
 * what some indexers gate or rate-limit on; if the *Arr sent none, ours is
 * used so the request never goes out without a User-Agent.
 *
 * Note this replaces the previous behaviour, which always CONCATENATED the
 * two ("Sonarr/4.0.0 UmlautAdaptarrEX/2.0") - a value that matched neither
 * client and could defeat exactly the UA allow-lists forwarding is for.
 */
export function outboundUserAgent(
  arrUserAgent: string | null | undefined,
  ownUserAgent: string,
  forwardArrUserAgent: boolean,
): string {
  if (!forwardArrUserAgent) return ownUserAgent;
  const forwarded = arrUserAgent?.trim();
  return forwarded || ownUserAgent;
}
