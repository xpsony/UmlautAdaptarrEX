# UmlautAdaptarrEX HTTP API

This is the wire reference for the Fastify gateway on port **5005**, the TCP HTTP-Proxy on port **5006**, and the
WebSocket log stream. All paths below come straight from
[src/server/index.ts](../src/server/index.ts) and the route modules in
[src/server/routes/](../src/server/routes/).

The Web UI on port `5007` reverse-proxies `/api/*` to Fastify at runtime via
[src/proxy.ts](../src/proxy.ts) (reading the API port from `API_UPSTREAM`), so all admin endpoints below
are also reachable through the UI's origin. This used to be `next.config.ts` rewrites, but
`output: "standalone"` bakes rewrite destinations in at build time and ignored a runtime-configured port,
so the proxy moved into the Node.js runtime.

The release-renaming pipeline behind the legacy XML routes is documented separately in
[docs/renaming.md](renaming.md).

## Authentication model

| Surface           | Auth                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/admin/*`    | Session cookie + CSRF (`requireAuth` preHandler). State-changing methods require `x-csrf-token`.                                                                                               |
| `/api/auth/*`     | Mixed. Login is public + rate-limited. Setup endpoints are public **only while `setupComplete=false`**, then 403. `/api/auth/me` and `/api/auth/logout` need a session.                        |
| `/api/health`     | Public.                                                                                                                                                                                        |
| Legacy `/<key>/*` | Plain api-key in URL. **Mode-gated**: in `operationMode=proxy` returns plain-text 503 to non-loopback callers; loopback (`127.0.0.1`) is always allowed so the on-host TCP proxy can re-enter. |
| `/ws/logs`        | Session cookie + same-origin upgrade.                                                                                                                                                          |
| TCP proxy :5006   | Basic auth using `Setting.proxyUsername` / `Setting.proxyPassword`.                                                                                                                            |

CSRF tokens are issued on login (`POST /api/auth/login` returns `{ ok, csrf }`) and persist via the signed `_csrf` cookie
(see [src/server/index.ts:90-117](../src/server/index.ts#L90-L117)). Send the token back in the `x-csrf-token` header.

Sessions live 14 days in production, 365 days in dev (`SESSION_TTL_MS` in
[src/lib/auth/session.ts](../src/lib/auth/session.ts)).

Global rate limit defaults are 60 requests / minute (per IP). Login and setup endpoints have stricter per-route limits
(see table below).

## `/api/health` — public

```http
GET /api/health
```

Returns `{ status: "ok" }`. Defined inline at
[src/server/index.ts:149-154](../src/server/index.ts#L149-L154). Used by the start.mjs supervisor and Docker
healthcheck. `uptime` was intentionally removed in 1.1.0 to avoid leaking process restart times to unauthenticated callers.

## `/api/auth/*` — login, setup wizard, session

Defined in [src/server/routes/admin/login.ts](../src/server/routes/admin/login.ts) and
[src/server/routes/admin/setup.ts](../src/server/routes/admin/setup.ts).

| Method | Path                                       | Auth       | Rate limit      | Purpose                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------ | ---------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/login`                          | public     | 5 / 5 min / IP  | Verify admin credentials, issue session + CSRF cookies. Returns `{ ok, csrf }`.                                                                                                                                                                      |
| POST   | `/api/auth/logout`                         | session    | global          | Revoke session, clear cookies.                                                                                                                                                                                                                       |
| GET    | `/api/auth/me`                             | session    | global          | Return `{ id, username }` for the current session.                                                                                                                                                                                                   |
| GET    | `/api/auth/setup-status`                   | public     | global          | Wizard gate. Returns `setupComplete`, persisted Prowlarr host (no key) and proxy defaults.                                                                                                                                                           |
| GET    | `/api/auth/plugins`                        | public     | global          | List built-in language plugins with current enable state.                                                                                                                                                                                            |
| POST   | `/api/auth/setup`                          | setup-open | 20 / 5 min / IP | Final wizard submission; creates the admin user, persists settings, flips `setupComplete=true`. 409 once setup is done.                                                                                                                              |
| POST   | `/api/auth/test-tmdb-key`                  | setup-open | 20 / 5 min / IP | Probe a TMDB v3 key. 409 once setup is done.                                                                                                                                                                                                         |
| POST   | `/api/auth/instances/test`                 | setup-open | 20 / 5 min / IP | Test a Sonarr/Radarr/Lidarr/Readarr connection from the wizard.                                                                                                                                                                                      |
| POST   | `/api/auth/prowlarr/test`                  | setup-open | 20 / 5 min / IP | Test Prowlarr connection. Returns `{ ok, appsCount, skippedCount }`.                                                                                                                                                                                 |
| POST   | `/api/auth/prowlarr/preview`               | setup-open | 20 / 5 min / IP | Fetch Prowlarr's connected applications. Real downstream API keys are replaced with opaque vault tokens; the wizard sends them back to `/api/auth/setup`, which resolves them server-side. Body accepts `{ host, apiKey }` or `{ useStored: true }`. |
| DELETE | `/api/auth/prowlarr`                       | setup-open | 20 / 5 min / IP | Drop persisted Prowlarr host/key (e.g. user opted to skip the Prowlarr step).                                                                                                                                                                        |
| GET    | `/api/auth/prowlarr/install-proxy/preview` | setup-open | 20 / 5 min / IP | Preview the auto-installed Prowlarr indexer-proxy config (default host, port, existing matching proxies). Requires persisted Prowlarr creds (409 if missing).                                                                                        |

"setup-open" means the route is public while `Setting.setupComplete=false` and refuses (`403` or `409`) afterwards.

## `/api/admin/*` — authenticated admin API

All routes require a valid session cookie (and CSRF token on state-changing methods) via the `requireAuth` preHandler in
[src/server/auth/middleware.ts](../src/server/auth/middleware.ts).

### Arr instances ([instances-crud.ts](../src/server/routes/admin/instances-crud.ts))

| Method | Path                        | Purpose                                                                   |
| ------ | --------------------------- | ------------------------------------------------------------------------- |
| GET    | `/api/admin/instances`      | List all configured Sonarr / Radarr / Lidarr / Readarr instances.         |
| POST   | `/api/admin/instances`      | Create a new instance (`type`, `name`, `host`, `apiKey`, optional flags). |
| PATCH  | `/api/admin/instances/:id`  | Partial update. Sends `apiKey` only when changing it.                     |
| DELETE | `/api/admin/instances/:id`  | Remove instance.                                                          |
| POST   | `/api/admin/instances/test` | Live `system/status` probe against an instance config (no DB write).      |

### Prowlarr admin ([prowlarr-admin.ts](../src/server/routes/admin/prowlarr-admin.ts))

| Method | Path                                                  | Purpose                                                                                                                   |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/instances/prowlarr/config`                | Read persisted Prowlarr host (returns `apiKeyConfigured: boolean`).                                                       |
| PUT    | `/api/admin/instances/prowlarr/config`                | Save / replace Prowlarr host + key.                                                                                       |
| DELETE | `/api/admin/instances/prowlarr/config`                | Forget Prowlarr config.                                                                                                   |
| POST   | `/api/admin/instances/prowlarr/test`                  | Probe Prowlarr `system/status`.                                                                                           |
| POST   | `/api/admin/instances/prowlarr/preview`               | Fetch downstream applications visible to Prowlarr. Mirrors the wizard preview but inside the authenticated admin surface. |
| POST   | `/api/admin/instances/prowlarr/import`                | Import selected Prowlarr applications as `ArrInstance` rows.                                                              |
| GET    | `/api/admin/instances/prowlarr/install-proxy/preview` | Preview the auto-install proxy config + existing matching proxies.                                                        |
| POST   | `/api/admin/instances/prowlarr/install-proxy`         | Auto-create the indexer-proxy entry inside Prowlarr.                                                                      |

### Settings ([settings.ts](../src/server/routes/admin/settings.ts))

| Method | Path                                            | Purpose                                                                                                                                     |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/settings`                           | Read settings. Secrets (`tmdbApiKey`, `tvdbApiKey`, `proxyPassword`) are returned as `*Configured: boolean` flags only, never as plaintext. |
| PUT    | `/api/admin/settings`                           | Update settings (cache TTL, log retention, provider order, user agent, secrets, etc.).                                                      |
| POST   | `/api/admin/settings/test-tmdb-key`             | Probe a TMDB key.                                                                                                                           |
| POST   | `/api/admin/settings/test-tvdb-key`             | Probe a TVDB key.                                                                                                                           |
| POST   | `/api/admin/settings/regenerate-apikey`         | Generate a new public legacy api-key.                                                                                                       |
| POST   | `/api/admin/settings/regenerate-proxy-password` | Rotate the TCP proxy password. Returns the new value once; not retrievable afterwards.                                                      |
| GET    | `/api/admin/title-cache`                        | Paginated title-cache entries.                                                                                                              |
| DELETE | `/api/admin/title-cache`                        | Clear the title cache (full or filtered).                                                                                                   |
| POST   | `/api/admin/title-cache/recheck-missing`        | Background re-resolve of negative-cache hits.                                                                                               |

### History & telemetry ([history.ts](../src/server/routes/admin/history.ts))

| Method | Path                         | Purpose                                                   |
| ------ | ---------------------------- | --------------------------------------------------------- |
| GET    | `/api/admin/request-history` | Paginated legacy-API request log (RequestHistory table).  |
| GET    | `/api/admin/rename-history`  | Paginated rename-rewrite log (RenameHistory table).       |
| GET    | `/api/admin/logs`            | Paginated rotating log buffer (LogEntry table).           |
| GET    | `/api/admin/stats`           | Cache hit/miss counters, provider stats, summary widgets. |

### Plugins ([plugins.ts](../src/server/routes/admin/plugins.ts))

| Method | Path                     | Purpose                                                                    |
| ------ | ------------------------ | -------------------------------------------------------------------------- |
| GET    | `/api/admin/plugins`     | List built-in language plugins with their current enable state.            |
| PATCH  | `/api/admin/plugins/:id` | Toggle a plugin's `enabled` flag. Hot-applies to the in-memory aggregator. |

### Sync ([sync.ts](../src/server/routes/admin/sync.ts))

| Method | Path                   | Purpose                                             |
| ------ | ---------------------- | --------------------------------------------------- |
| POST   | `/api/admin/sync`      | Trigger an immediate full or per-instance sync run. |
| GET    | `/api/admin/sync-runs` | Paginated sync-run history.                         |

### System ([system.ts](../src/server/routes/admin/system.ts))

| Method | Path                             | Purpose                                                                                 |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/admin/system/capabilities` | `{ canRestart }`. `false` outside the supervised production process (e.g. `pnpm dev`).  |
| POST   | `/api/admin/system/restart`      | Replies 202, then exits with code 75 so [start.mjs](../start.mjs) respawns the process. |

## Legacy indexer routes (Newznab/Torznab compat)

Defined in [src/server/routes/legacy/](../src/server/routes/legacy/), wired in
[src/server/index.ts:150-176](../src/server/index.ts#L150-L176).

```http
GET /<apiKey>/<host>/api?t=caps
GET /<apiKey>/<host>/api?t=search&cat=<ids>&q=<q>
GET /<apiKey>/<host>/api?t=tvsearch&tvdbid=<id>&q=<q>
GET /<apiKey>/<host>/api?t=movie&tmdbid=<id>&q=<q>
GET /<apiKey>/<host>/api?t=music&q=<q>
GET /<apiKey>/<host>/api?t=book&q=<q>
```

Wire-compatible byte-for-byte with the .NET 1.x predecessor (XML response shape, attribute order). Don't change without
running the `legacy-compat-check` skill against `old_code/UmlautAdaptarr/`.

**Mode gate**: when `Setting.operationMode = "proxy"`, non-loopback callers receive

```
HTTP/1.1 503 Service Unavailable
Content-Type: text/plain; charset=utf-8

Index Legacy Api wurde deaktiviert, bitte Einstellungen anpassen
```

The on-host TCP proxy on `:5006` is allowed through because it loops back to `127.0.0.1` (see
[src/server/routes/legacy/util.ts](../src/server/routes/legacy/util.ts)).

## TCP HTTP-Proxy (port 5006)

Implemented in [src/server/proxy/http-proxy.ts](../src/server/proxy/http-proxy.ts). Used by Prowlarr's _Indexer Proxy_
feature.

- **HTTP**: incoming `GET http://<indexer>/api?...` is rewritten to
  `GET http://127.0.0.1:5005/<apiKey>/<indexerHost>/api?...` so the legacy handler can intercept and rewrite.
- **HTTPS**: only `CONNECT` to the Prowlarr/Servarr host allowlist (currently `prowlarr.servarr.com`) is tunneled through.
  Other CONNECTs are rejected.
- **Auth**: `Proxy-Authorization: Basic …` validated against `Setting.proxyUsername` / `Setting.proxyPassword`.
  407 + `Proxy-Authenticate: Basic` on missing or wrong credentials.
- When `Setting.operationMode = "legacy"` the port is bound to a stub
  ([disabled-stub.ts](../src/server/proxy/disabled-stub.ts)) that immediately closes connections, leaving the port in a
  predictable state.
- The mode is read once at boot. Switching `operationMode` in the admin UI requires a server restart for the proxy port
  change to take effect (the UI flags this).

## WebSocket — `/ws/logs`

Attached in [src/server/logging/broadcast.ts:106](../src/server/logging/broadcast.ts#L106), invoked from
[src/server/index.ts:193](../src/server/index.ts#L193).

- **URL**: `ws://<host>:5005/ws/logs`
- **Auth**: requires a valid session cookie _and_ a same-origin `Origin` header. Other upgrades are rejected with 401.
- **Frames**: JSON-encoded log records (level, time, msg, plus pino fields). Used by the admin UI's live-logs panel.

## Error envelope

The error handler in [src/server/index.ts:258-302](../src/server/index.ts#L258-L302) emits a uniform shape:

```json
// Validation (400)
{ "error": "validation", "issues": [/* zod issues */], "message": "..." }

// 4xx
{ "error": "request_error", "message": "..." }

// 5xx
{ "error": "internal", "message": "Internal server error" }

// Not found
{ "error": "not_found" }
```

Some routes layer additional `error` codes (`invalid-credentials`, `setup-already-complete`, `no_stored_creds`,
`fetch_failed`) on top of these for the UI's error mapping. Search for the literal string in
[src/messages/](../src/messages/) to find user-facing translations.
