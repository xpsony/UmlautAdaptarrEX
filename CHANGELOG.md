# Changelog

## 1.1.0 — 2026-05-24

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

### Build & Tooling

- **pnpm:** Bumped pnpm to `11.3.0` across Dockerfile, devcontainer, README and `package.json#packageManager`. Removed the deprecated top-level `pnpm` block from `package.json` and moved build allow-lists into `pnpm-workspace.yaml`.
- **ESLint:** Pinned the React version to `19` in `eslint.config.mjs` so `eslint-plugin-react` no longer has to auto-detect it.
- **ESLint major bump:** `eslint` `9.39.4` → `10.4.0`.
- **Node types:** `@types/node` `24.12.3` → `25.9.1` (major).

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
