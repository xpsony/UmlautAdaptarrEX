# Changelog

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
