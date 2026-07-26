# Changelog

## 1.3.0 — 2026-07-26

Adds an optional headless mode for lean, UI-less deployments, fixes two rename/settings bugs, and refreshes the whole dependency stack. Headless is opt-in and off by default, so existing installs are unaffected. No schema changes, no configuration changes.

### Features

- **Headless mode:** setting `UMLAUTADAPTARREX_HEADLESS=1` runs the container without the Next.js Web UI and without the self-forking supervisor — a single Node process (Fastify + TCP proxy). In this project's Docker tests a minimally-configured container dropped from ~160 MiB (over 200 MiB with the Web UI open) to ~115 MiB headless, roughly a third / ~50-90 MB less depending on config. Only works for an already-configured instance (the setup wizard still runs exclusively in the Web UI); the container refuses to boot headless against an unconfigured database, with an explanatory error. When enabled, the Web UI port (default 5007) can be dropped from the compose port mapping.

### Fixes

- **Settings could no longer be saved when the proxy port is pinned by the environment:** with `UMLAUTADAPTARREX_PROXY_PORT` set, every save from the Settings page — on any tab, not just Advanced — was rejected with a `proxy-port-env-managed` conflict, because the form round-tripped the read-only, env-managed port value back to the server. The Web UI now omits the field entirely when the port is env-managed, and the server treats an unchanged value as a no-op instead of a conflict. Sending a *different* value while the env var is set is still rejected with 409, so the "your edit would silently have no effect" guard stays intact.
- **Trailing punctuation leaked into renamed titles:** when the title variation that matched carried no parentheses but the release name did (e.g. variation "Chronicles of Time 2005" against `Chronicles.of.Time.(2005).S08E08...`), the closing `)` was left unconsumed and the rewrite emitted a doubled character — `Chronicles.of.Time.(2005).).S08E08...`. Closing delimiters (`)`, `]`, `}`) directly after the matched title are now skipped. Applies to both the movie/TV and the book/audiobook rename path; opening delimiters are deliberately left alone so a release named `Chronicles of Time(2005)...` still renames correctly.

### Security & maintenance

- **Dependency refresh:** the full stack bumped to current — Prisma `7.8.0` → `7.9.0` (client, CLI and the better-sqlite3 adapter), Next.js `16.2.10` → `16.2.11`, React `19.2.7` → `19.2.8`, argon2 `0.44.0` → `0.45.1`, nanoid `5.1.16` → `6.0.0`, better-sqlite3 `12.11.1` → `13.0.1`, undici `8.7.0` → `8.9.0`, recharts `3.9.2` → `3.10.0`, lucide-react `1.24.0` → `1.26.0`, react-hook-form `7.81.0` → `7.83.0`, next-intl `4.13.1` → `4.13.4`, fast-xml-parser `5.9.3` → `5.10.1`, ws `8.21.0` → `8.21.1`, `@fastify/cookie` `11.1.0` → `11.1.2`, `@tanstack/react-query` `5.101.2` → `5.101.4`, the Radix UI set, plus dev tooling (ESLint `10.8.0`, Prettier `3.9.6`, typescript-eslint `8.65.0`, Playwright `1.62.0`, Vite `8.1.5`, Tailwind `4.3.3`, postcss `8.5.23`, tsx `4.23.1`, autoprefixer `10.5.4`, concurrently `10.0.4`). TypeScript stays on the 6.x line (7.0 breaks the current type-check).
- **CI & dependency automation:** `actions/setup-node` bumped to v7. Dependabot now applies a 3-day cooldown on all ecosystems, so freshly-published releases are not pulled in immediately, and auto-merge no longer needs a PR approval — it gates on the status check alone.

### Upgrade notes

- No action needed — this release has no schema changes and no configuration changes. Headless mode is opt-in and off by default; to use it, complete the setup wizard once with the Web UI enabled, then set `UMLAUTADAPTARREX_HEADLESS=1` and restart. Remove the variable temporarily whenever you need to change configuration in the Web UI.

## 1.2.5 — 2026-07-10

A maintenance release: all dependencies and the build toolchain are refreshed, CI and the dev container move to Node 26 (the production image already ran Node 26), and an automated Docker security rebuild keeps the published `:latest` image patched with OS/base-image security updates between releases. No schema changes, no configuration changes.

### Improvements

- **Automatic Docker security rebuilds:** a scheduled workflow (`.github/workflows/security-rebuild.yml`) now rebuilds the latest stable release image every 2 days with a fresh base image and OS packages (`pull` + `no-cache`), so `:latest` picks up Debian/Node security patches without waiting for a new release. It publishes `:latest` and a `:<version>-<sha>` variant; the immutable `:<version>` tag from the release build is left untouched.

### Security & maintenance

- **Dependency refresh:** all dependencies bumped to their latest patch/minor — pnpm `11.3.0` → `11.11.0`, Fastify `5.8.5` → `5.10.0`, Next.js `16.2.9` → `16.2.10`, recharts `3.8.1` → `3.9.2`, lucide-react `1.21.0` → `1.24.0`, undici `8.5.0` → `8.7.0`, the Radix UI set, plus dev tooling (ESLint `10.6.0`, Vitest `4.1.10`, Vite `8.1.4`, Prettier `3.9.4`, tsx `4.23.0`, typescript-eslint `8.63.0`, Playwright `1.61.1`). TypeScript stays on the 6.x line (7.0 breaks the current type-check). `pnpm audit --prod` reports no known vulnerabilities in the shipped runtime dependencies.
- **Node 26 across the board:** CI and the dev container now run on Node 26, matching the production image; the server bundle now targets Node 24. GitHub Actions bumped (`actions/checkout` v7, `actions/cache` v6).
- **Dependency PRs target `dev`:** Dependabot now opens against the `dev` branch instead of `main`, so updates land on the active branch and auto-merge after CI (patch/minor; majors stay manual) — removing the `main`→`dev` back-merge.

### Upgrade notes

No action needed — this release has no schema changes and no configuration changes.

## 1.2.4 — 2026-06-21

A stability and hardening release: title-provider syncs and the supervisor no longer hang on stalled connections, the indexer proxy and the admin/setup endpoints are hardened, and several title-matching and Web UI bugs are fixed. No schema changes.

### Fixes

- **Operation-mode descriptions show the configured ports** ([#30](https://github.com/xpsony/UmlautAdaptarrEX/issues/30)): the operation-mode texts in the setup wizard and Settings → Operation mode hard-coded `5005`/`5006` even when the ports had been remapped via `UMLAUTADAPTARREX_LEGACYAPI_PORT` / `UMLAUTADAPTARREX_PROXY_PORT`. They now interpolate the resolved ports (env override > stored/default). Thanks to [xopez](https://github.com/xopez) for reporting.
- **Sync no longer hangs on a stalled provider:** TVDB, pcjones and TMDB requests now carry request timeouts (`bodyTimeout`/`headersTimeout`), so a single unresponsive title provider can no longer block one of the bulk lookup slots — and therefore the whole sync — indefinitely.
- **One bad provider no longer aborts the chain:** each provider in the configured order is now isolated; a provider that throws (e.g. pcjones on a network error) is logged and skipped so the remaining providers still contribute, instead of discarding already-merged results.
- **Title matching:** titles containing tabs or line breaks are no longer collapsed into a single word (whitespace is normalized before stripping), and leading articles (`Der`/`Die`/`Das`/`The`/…) are now stripped case-insensitively, so lowercase or all-caps titles produce the same search variations as title-cased ones. `getReadarrTitleForExternalId` now strips the active language pack's articles instead of only the English "the".
- **Boot & restart robustness:** `runPrismaMigrate` now attaches an `error` handler (and uses `process.execPath`), so a failed `prisma migrate deploy` launch surfaces an error instead of hanging the boot forever. The supervisor now tracks the Next.js child's real exit, so a process that ignores `SIGTERM` is actually `SIGKILL`-ed within the grace window and can no longer orphan the Web UI port on restart. The admin Restart endpoint now ties teardown to the response being flushed instead of a fixed 250 ms timer.

### Improvements

- **Indexer proxy hardening:** the plain-HTTP relay path now restricts targets to ports 80/443 (matching the HTTPS-CONNECT allow-list), destroys upstream/client sockets on error or clean close, and adds a 120 s idle timeout — closing an SSRF / open-relay gap and a socket leak.
- **Reduced database load on large installs:** the per-request session `lastUsed` write is now throttled to at most once every 5 minutes (it previously wrote on every authenticated request, including the UI's polling), and "Recheck missing titles" scans the title cache in bounded id-cursor batches instead of loading the entire table (with translations) into memory at once. Request-history rows now cap the stored `domain`/`query` length.
- **O(n) variation dedup & regex reuse** in the title-variation hot path; minor allocation cleanups.

### Security & maintenance

- **Auth-surface hardening:** the unauthenticated `/api/auth/setup-status` and `/api/auth/plugins` endpoints are now rate-limited, and `setup-status` no longer discloses the persisted Prowlarr host or proxy username once setup is complete (the Prowlarr API key was never exposed). The Prowlarr admin routes (preview/import/test/save) are now rate-limited.
- **Content-Security-Policy:** a CSP header was added (`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`; script/style intentionally relaxed to keep the Next.js App Router working).
- **Password generation:** the generated proxy/admin passwords now use cryptographically-secure randomness only (no `Math.random` fallback) and rejection-sampling to remove modulo bias.
- **Secret-mask detection** was tightened so a legitimate stored secret is no longer mistaken for the mask sentinel and silently dropped on a settings round-trip, while Prowlarr's asterisk masking is still recognized.

### Web UI fixes

- Closing the Prowlarr-import dialog while it is still loading no longer races a state update onto the closed dialog, and a double-submit window on import was closed.
- The live-log list now keys on a stable client-assigned id, fixing row shifting/flicker as new lines are prepended.
- The dashboard and instances pages now render a distinct error state with a retry action when a request fails, instead of showing zeroed widgets / an empty list. A setup-step link is only rendered for a valid `http(s)` host.

### Upgrade notes

No action needed — this release has no schema changes and no configuration changes.

## 1.2.3 — 2026-06-06

Lets the container run fully unprivileged and ships as a TrueNAS Community app. Until now the image required root at startup; root is now used only for the one-time `/data` ownership fix and the application process never runs as root. No schema changes.

### Features

- **TrueNAS Community app:** UmlautAdaptarrEX is now available in the TrueNAS app catalog ([apps.truenas.com/catalog/umlautadaptarrex_community](https://apps.truenas.com/catalog/umlautadaptarrex_community/)) — search for "UmlautAdaptarrEX" under Apps → Discover Apps to install. The app is maintained by [xopez](https://github.com/xopez), many thanks.

### Improvements

- **Unprivileged container startup:** The image can now be started directly as a non-root user (`docker run --user`, a compose `user:` entry, Kubernetes `runAsUser`, or the TrueNAS app's `run_as` field). In that case the entrypoint skips the `chown`/`gosu` step and runs directly under the given UID/GID, so the container no longer needs the `CHOWN`/`SETUID`/`SETGID` capabilities or root, provided the `/data` volume is already owned by that UID/GID.

### Security & maintenance

- **root only for ownership setup:** When the container does start as root (the default), root is used **only** for the one-time `chown` of `/data`; the entrypoint then drops to `PUID:PGID` via `gosu` before launching the app, so the application process (`node start.mjs`) never runs as root. The startup path is fully backward-compatible with the existing root-by-default compose setup.

### Upgrade notes

No action needed for the default Docker / compose setup. To run unprivileged, pre-own the `/data` volume with your target UID/GID and start the container with that user (e.g. `--user 1000:1000`); `PUID`/`PGID` are ignored in that mode since the orchestrator already sets the UID/GID.

## 1.2.2 — 2026-06-05

Adds a Proxmox LXC community-script, surfaces the actual service ports in the UI, and fixes API proxying plus the setup flow behind Docker NAT. Includes one additive database migration (`AdminUser.lastSeenChangelog`), applied automatically on start.

### Features

- **Proxmox LXC community-script installer:** A one-line command creates an LXC container on Proxmox VE, installs UmlautAdaptarrEX and prompts for the service ports during setup. The installer is self-hosted from this fork. Still in development and not yet fully tested, see the README before using it.
- **Service ports in the UI:** Settings → Advanced now shows the active Fastify API port and Web UI port read-only alongside the editable proxy port, so the bound ports are visible without inspecting the environment.

### Improvements

- **Changelog shown once per user:** The what's-new dialog tracks its seen-state per admin account in the database (`AdminUser.lastSeenChangelog`) instead of per browser. Each user sees it exactly once and, after confirming, it stays dismissed across browsers and devices until a newer release ships.
- **Branded port variables only:** Service ports are now read only from `UMLAUTADAPTARREX_LEGACYAPI_PORT` / `UMLAUTADAPTARREX_WEBUI_PORT` / `UMLAUTADAPTARREX_PROXY_PORT`. The legacy `PORT` and `WEB_PORT` fallbacks (still accepted in 1.2.1) have been removed; the compose files and `.env.example` already use the branded names.

### Fixes

- **Runtime API proxying:** The Web UI now reverse-proxies `/api/*` at runtime instead of baking the API port into the standalone build. A custom `UMLAUTADAPTARREX_LEGACYAPI_PORT` no longer left `/api/health` and the \*Arr icons failing with `ECONNREFUSED`, and static `/arr/*.svg` icons are no longer redirected to `/setup` during the wizard.
- **Setup behind Docker NAT:** The pre-setup instance test (`/api/auth/instances/test`) no longer hard-blocks private/LAN targets by default; it follows the SSRF-strict toggle (`Setting.blockPrivateInstanceHosts`, default off). Connecting to Sonarr/Radarr on the same LAN now succeeds out of the box during the wizard, while strict mode restores loopback-only behaviour for cloud / multi-tenant operators.

### Security & maintenance

- **Auth-surface hardening:** `/api/auth/me` is now rate-limited per IP (60 / min)
- **Dependencies updated:** All pnpm packages bumped to their latest patch/minor releases — Next.js `16.2.7`, React / React-DOM `19.2.7`, `@tanstack/react-query` `5.101.0`, plus dev tooling (`eslint-config-next`, `typescript-eslint`, `concurrently`, `@types/react`). No behaviour changes; `pnpm audit` reports no known vulnerabilities.

### Upgrade notes

The new `AdminUser.lastSeenChangelog` column is applied automatically by `prisma migrate deploy` on start. If you relied on the `PORT` or `WEB_PORT` environment variables, switch to `UMLAUTADAPTARREX_LEGACYAPI_PORT` / `UMLAUTADAPTARREX_WEBUI_PORT`.

## 1.2.1 — 2026-06-02

Lets you set all three service ports through environment variables before the first start, so Docker users can avoid host port clashes without editing the app. No schema changes.

### Features

- **Configurable service ports:** New environment variables `UMLAUTADAPTARREX_LEGACYAPI_PORT` (Fastify API + legacy indexer API + log stream, default `5005`), `UMLAUTADAPTARREX_WEBUI_PORT` (Web UI, default `5007`) and `UMLAUTADAPTARREX_PROXY_PORT` (Prowlarr indexer proxy, default `5006`). The compose files and `.env.example` pick these up, so a single value moves both the container bind port and the published host port. The existing `PORT` and `WEB_PORT` variables keep working as fallbacks.

### Improvements

- **Env-managed proxy port:** When `UMLAUTADAPTARREX_PROXY_PORT` is set it overrides the stored proxy port at every start, and the proxy-port field under Settings → Advanced is shown read-only with a hint so the value cannot drift out of sync. The live-log view and the proxy URL advertised to Prowlarr both follow the configured ports automatically.

## 1.2.0 — 2026-06-02

Adds the Prowlarr indexer-patch dialog, plus a dependency refresh and a Docker healthcheck fix. No schema changes.

### Features

- **Prowlarr indexer patching:** A new dialog lists your Prowlarr indexers and lets you select which ones to patch for UmlautAdaptarrEX. Patching tags the indexer with `umlautadaptarrex` and switches its Prowlarr base URL from `https://` to `http://` so requests flow through the local proxy and titles get rewritten; de-selecting reverts both. Available in the setup wizard and any time under Settings, Prowlarr. The dialog explains why the switch is needed and that the connection to the indexer itself stays HTTPS (no unencrypted traffic leaves your system).

### Fixes

- **Bare-metal start without Docker:** `pnpm prod` (and `pnpm build:prod && pnpm start:prod`) now boots correctly on a host without Docker. The supervisor finds the Next.js standalone server on bare-metal installs and assembles its `.next/static` and `public` assets next to it on boot, so no manual copy step is needed.

### Build & Tooling

- **Docker healthcheck:** Switched the container healthcheck from `wget --spider` to `wget -qO- … >/dev/null` back.

### Dependency Updates

- `concurrently` `9.2.1` → `10.0.1` (major; affects only the `dev` script)
- `next-intl` `4.12.0` → `4.13.0`
- `lucide-react` `1.16.0` → `1.17.0`
- `react-hook-form` `7.76.1` → `7.77.0`
- `lru-cache` `11.5.0` → `11.5.1`
- `eslint` `10.4.0` → `10.4.1`, `typescript-eslint` `8.59.4` → `8.60.0`
- `vite` `8.0.14` → `8.0.16`, `vitest` / `@vitest/coverage-v8` `4.1.7` → `4.1.8`
- `tsx` `4.22.3` → `4.22.4`

## 1.1.1 — 2026-05-25

### Fixes

- **Lidarr/Readarr sync no longer crashes on duplicate album/book titles:** Library rows are now keyed by `normalize("{artist} {album}")` for Lidarr and `normalize("{book} {author}")` for Readarr instead of just the album/book title. Previously libraries with multiple albums or books sharing a title across artists/authors ("Greatest Hits", "Live", "Best Of", "Self-Titled", …) collided on the SearchItem unique constraint and aborted the sync with Prisma `P2002`. As a side effect the legacy `/api?t=search&cat=3000…` `getByExternalId` lookup now actually resolves, because Prowlarr's `?q=Artist Album` query normalizes to the same key the row was stored under.
- **Sync dedup defense-in-depth:** `persistAndReindex` now deduplicates items by externalId before writing, so a stray duplicate in the upstream payload no longer aborts a 50-item chunk transaction. Duplicates are counted and warned in the log; `SyncRun.itemsCount` reflects the deduped count.
- **Scheduler provider gate:** `POST /api/admin/sync` and the scheduled tick no longer return `no_provider` for Lidarr/Readarr-only setups. The gate now only blocks when at least one Sonarr/Radarr instance is enabled, because only those two consult a title provider during sync.

### Upgrade notes

No manual resync required. On the next sync (automatic or via "Sync now" in the dashboard) the stale rows with old externalIds are removed

## 1.1.0 — 2026-05-25

### Providers & Settings

- **TVDB credentials:** API key and subscriber PIN can now be configured both in the setup wizard (admin step) and on the admin settings page. Credentials are stored masked, can be tested live before saving, and are surfaced via a new reusable `SecretField` component used for both TMDB and TVDB. The admin settings route persists TVDB keys alongside TMDB.

### Security & Auth Hardening

- **Session fixation:** The session ID is now rotated on a successful admin login instead of reusing the pre-auth cookie.
- **CSRF gate:** The double-submit check is properly awaited in the admin middleware; previously the route handler could run before the verification settled. The CSRF secret length is also validated up-front.
- **Login enumeration:** Logins for unknown users now run a dummy Argon2 verification so the response time matches the "wrong password" path.
- **Cookies:** Session and CSRF cookies are forced to `Secure` whenever the request is served over HTTPS, regardless of `NODE_ENV`. Production session TTL is also the default if `NODE_ENV` is missing.
- **Log redaction:** Added a shared redactor that masks `apiKey`, `password`, `prowlarrApiKey` and similar fields in log output, including legacy-route logs and the WebSocket log broadcast.
- **Health endpoint:** Removed `uptime` from `/api/health` so the field can't be used as a process fingerprint.
- **WebSocket upgrades:** Upgrade errors are now caught and surfaced as a 400 instead of crashing the request.
- **Admin responses:** Third-party secrets (TMDB, TVDB, Prowlarr API keys, proxy password) are masked in settings responses; the Prowlarr install preview tokenises secrets via the vault before rendering.

### Setup Wizard

- **Race re-check:** Concurrent setup completions are detected (Prisma `P2002`) and the wizard re-checks the canonical state instead of failing the second request.
- **Plugin validation:** Unknown plugin IDs are rejected up-front rather than silently ignored.
- **SSRF probes:** Outbound probes from the wizard (Prowlarr connect) are gated until setup is far enough along, so unauthenticated callers can't use the wizard as an SSRF primitive.

### Providers & Sync

- **TMDB:** Switched bulk lookups to `Promise.allSettled` so one failing ID can't abort the entire batch.
- **TVDB:** Added a retry guard around token refreshes; a 401 storm no longer triggers an infinite retry loop.
- **Rate limiter:** Clamps negative `Retry-After` values to a sane minimum.
- **Scheduler watchdog:** Detects stuck sync runs and unblocks the scheduler instead of waiting forever.

### Sync Performance

- **Parallel instance sync:** `runSync` now fans out across all enabled Sonarr/Radarr/Lidarr/Readarr instances via `Promise.all` instead of iterating sequentially; wall-time drops from sum-of-instances to max-of-instances.
- **Lidarr/Readarr nested fetches:** `fetchNested` (artist→album, author→book) now batches child requests at concurrency 8 instead of one parent at a time.
- **TMDB bulk lookups:** Parallel batches of 10 in `fetchBulk`, capped at 20 req/s start-spacing (50 ms interval). That's ~50% of the documented ~40 req/s ceiling. A 500-item bulk drops from ~2 min of pure rate-limit wait to ~25 s.
- **TVDB bulk lookups:** Parallel batches of 5, capped at 10 req/s (100 ms interval). Conservative because TVDB publishes no explicit ceiling and each lookup fans out into multiple nested calls.
- **Concurrency-safe rate limiter:** `HostRateLimiter` in `src/providers/rate-limit.ts` rewritten to a per-host promise-chain. The previous timestamp-comparison pattern raced under parallelism (all concurrent callers read the same `lastFetch` and started in lockstep, leaking the rate budget); each `wait()` now strictly serialises _starts_ while letting in-flight requests overlap.
- **DB-upsert chunks:** `persistAndReindex` splits a single mega-transaction into chunks of 50 upserts. The SQLite writer lock is released between chunks, letting parallel instance syncs interleave instead of fully serialising; mid-sync crashes also lose at most 50 items of progress.

### Fixes

- **Tests:** Explicitly typed the `chunk` parameter as `Buffer` in the socket `data` handlers of `tests/api/tcp-proxy.test.ts` and `tests/unit/disabled-proxy-stub.test.ts`.
- **Tests (session rotation):** Rewrote `tests/api/session-edge-cases.test.ts` "concurrent sessions" block to assert the single-session policy added by the session-fixation fix above (a second login invalidates the prior session row; logout invalidates the current session).
- **Tests (prowlarr admin preview):** Updated `tests/api/prowlarr-admin-flow.test.ts` to expect `__ua_key:` vault tokens in the admin `/preview` response, matching the vault-tokenisation hardening above.
- **Tests (auth cookies):** Added `tests/unit/auth-cookies.test.ts` covering `Secure` cookie behaviour for HTTP vs. HTTPS requests and tidied the surrounding `_auth-cookies.ts` helper.

### Build & Tooling

- **pnpm:** Bumped pnpm to `11.3.0` across Dockerfile, devcontainer, README and `package.json#packageManager`. Removed the deprecated top-level `pnpm` block from `package.json` and moved build allow-lists into `pnpm-workspace.yaml`.
- **ESLint:** Pinned the React version to `19` in `eslint.config.mjs` so `eslint-plugin-react` no longer has to auto-detect it.
- **ESLint major bump:** `eslint` `9.39.4` → `10.4.0`.
- **Node types:** `@types/node` `24.12.3` → `25.9.1` (major).
- **Docker:** Reworked the Dockerfile for better layer caching (dependency install separated from source copy), refreshed base image references, and ensured `pnpm-workspace.yaml` is copied into the build context so `pnpm install` succeeds inside the image.

### Dependency Updates (minor/patch)

- `@hookform/resolvers` `5.2.2` → `5.4.0`
- `@tanstack/react-query` `5.100.9` → `5.100.14`
- `fast-xml-parser` `5.7.3` → `5.8.0`
- `lru-cache` `11.3.6` → `11.5.0`
- `react-hook-form` `7.75.0` → `7.76.1`
- `tailwind-merge` `3.5.0` → `3.6.0`, `tailwindcss` / `@tailwindcss/postcss` `4.2.4` → `4.3.0`
- `undici` `8.2.0` → `8.3.0`, `ws` `8.20.0` → `8.21.0`
- `@playwright/test` `1.59.1` → `1.60.0`
- `@vitest/coverage-v8` / `vitest` `4.1.5` → `4.1.7`, `vite` `8.0.11` → `8.0.14`
- `@types/react` `19.2.14` → `19.2.15`
- `postcss` `8.5.14` → `8.5.15`, `tsx` `4.22.1` → `4.22.3`
