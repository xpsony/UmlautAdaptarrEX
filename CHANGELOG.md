# Changelog

## Unreleased

### Features

- **Sync intervals are configurable, and the default cadence is much shorter.** Instead of one hard-coded full sync every 12 hours there are now two intervals (Settings, range-checked): a **quick sync** every 10 minutes and a **full sync** every 24 hours. The quick sync fetches the \*Arr's title listing and processes only what actually changed - additions, removals, and titles the \*Arr itself renamed. When nothing changed it writes no `SearchItem` row, creates no `SyncRun` row and never calls a title provider, which is what makes a 10-minute cadence affordable: a full pass on a 2,000-title library used to rewrite every row whether or not it had changed. The full sync is still the pass that re-queries every provider, so it remains the one that picks up German titles which appeared upstream after a title was first synced. Three presets are offered: **Recommended** (10 min / 24 h), **Frugal** (60 min / 24 h) and **Like 1.x** (quick sync off / 12 h).
  - An instance that has never had a full sync always gets one first. That is the one-time initial scan; quick syncs only take over afterwards.
  - "Sync now" in the UI is always a full sync - pressing the button should mean a real refresh.
  - Sync runs now record their `kind` (`full` / `delta`) and can be filtered by it.
- **A title nobody synced yet is now resolved while its search is still in flight.** When a search arrives for a tvdbid, tmdbid or imdbid that isn't in the cache, UmlautAdaptarrEX asks your Sonarr or Radarr about that one title and then its title providers, and uses the answer for **that** request. This is the case a shorter sync interval cannot fix: a request in Jellyseerr or Overseerr makes Radarr create the movie and search for it in the same second, so even a 10-minute quick sync misses the window entirely. Previously the German release was simply overlooked and you had to search again later.
  - The lookup runs **in parallel** with the indexer request it belongs to and is capped at 5 seconds, so in practice it adds no waiting time. A timeout, an unreachable \*Arr or a provider outage all leave the response exactly as it was before this feature existed - there is no path where the lookup can make a search worse.
  - An id nobody knows is remembered as a miss for 30 minutes, concurrent searches for the same id share one lookup, and at most four resolutions run at a time. A burst of unknown ids cannot turn into a burst of outbound calls.
  - Resolved titles live in memory only (bounded, 12 hours) and never become library entries. The next regular sync takes over and shadows them. Provider answers are cached in the database as usual, so a restart costs a database read rather than another outbound call.
  - Series get the full treatment right away, including the search with German title variations. Films get the rewrite; the variation search for films follows separately.
  - Searches that carry **only** an `imdbid` need a TMDB key configured, because the id has to be mapped to a TMDB id first.

- **Sync-run history is cleaned up.** `SyncRun` rows were never purged. At two runs a day that went unnoticed; at the new cadence it would not. They now fall under the existing **History retention (days)** setting, alongside request and rename history.

### Internal

- The \*Arr clients are split into a raw fetch (`fetchRawItems`) and a derive step (`deriveItems`), so the quick sync can diff the instance's listing without paying for a provider lookup on every title, and a single title can be resolved on its own. No change in behaviour.
- The search-item lookup index moved out of `AppState` into its own `SearchItemIndex`, with targeted single-item removal and an IMDb-id lookup. No change in behaviour.

## 1.4.0 - 2026-08-27

The biggest release since the rewrite. Headline feature: a new **Library** page that finally makes the synced title data visible - and lets you fix individual mismatches with **manual title overrides** instead of clearing the whole cache. Around it: a full table/UX overhaul (sorting, URL-persisted filters, detail views, CSV export), history pagination with configurable retention, a performance and robustness pass on the sync/search hot paths, and a complete accessibility & translation sweep.

Also in this release: the reported **"the German title is never sent to the indexers"** case is fixed, and **renaming is now configurable** in a new Settings tab. Four new database migrations run automatically on first start. Existing installations keep their current renaming output - the two toggles that change what is delivered to the \*Arr are switched off for them and default to on only for fresh installs.

### Features

- **Library page (`/library`):** browse every synced title across all instances - original title, resolved German title and all generated search variations, with server-side search, filters (instance, media type, "missing German title only") and pagination. This is the data the matching engine actually works with; previously it was only visible in log lines.
- **Manual title overrides:** fix a single mismatched title from the Library detail view. An override is stored per medium (`mediaType` + external id), applies to **all** instances, survives re-syncs and library removal/re-add, and recomputes the search variations immediately - the fix is searchable at once, not after the next 12h sync. Removing an override restores the provider-resolved title (or re-resolves on the next sync). Sync runs apply overrides at assembly time, sourcing multi-language variations from the title cache so non-German language plugins keep their variations.
- **Sortable columns** on request history, rename history, sync runs and the library. Sorting is server-side against a per-endpoint whitelist, with a stable id tiebreaker so page boundaries never duplicate or skip rows.
- **Filters, page and sorting live in the URL** on all four list pages: reload, browser back and deep links reproduce exactly the view you had. Default values are kept out of the URL.
- **Sync runs list rebuilt:** server-side pagination, free-text search (instance name, error message) and a status filter replace the old 200-run display cap.
- **Row detail views** for request history and sync runs: full untruncated query strings and error messages, per-provider item counters, localized timestamps. An open sync-run sheet live-updates while the run progresses.
- **CSV export** for request and rename history: respects the current filter and sort order, RFC-4180 quoting, UTF-8 BOM (umlauts survive Excel), spreadsheet formula injection neutralized, capped at 10,000 rows (`x-truncated` response header when the cap hits).
- **Per-instance actions in the instances list:** "Test connection" and "Sync now" directly from the row menu (desktop table and mobile cards). Connection tests run through a new server-side endpoint (`POST /api/admin/instances/:id/test`), so the stored API key never round-trips through the browser.
- **History pagination & retention:** request and rename history paginate through all stored entries (page size 25/50/100/250) with server-side search across the whole retained period, and the new setting **History retention (days)** (Settings → Advanced, default 30, range 1–365) cleans up older entries automatically every 6 hours. Previously these tables grew without limit, and search only covered the newest rows ([#115](https://github.com/xpsony/UmlautAdaptarrEX/issues/115) - thanks [@Tom-Furrer](https://github.com/Tom-Furrer) for the report).
- **Per-tab settings forms:** each settings tab is an independent form - dirty state no longer leaks across tabs, saves send only that tab's fields, and the browser warns before unloading with unsaved changes.
- **Language switch without reload:** switching the UI language now refreshes in place (React Server Component refresh) - form state and scroll position survive.
- **Renaming is configurable** (Settings → Renaming). Six toggles, each shown with a worked before/after example on an invented release name so the effect is visible without reading docs:
  - _Strip unwelcome characters_ - removes `: ? * " < > | / \` from the inserted title without leaving a doubled separator. Scene releases never carry them, and Sonarr/Radarr parse the result more reliably. The indexer's own suffix is left verbatim. **On for new installs, off for existing ones.**
  - _Attach external ids_ - appends `tvdbid` / `tmdbid` / `imdb` as a newznab attribute to every matched item, so the \*Arr can bind a release without parsing its title. Purely additive: an id the indexer already sent is never overwritten, the feed's own attribute prefix (`newznab:` / `torznab:`) is mirrored, and ids are attached even when the rewrite itself was declined - which is exactly the case where they help most. **On for new installs, off for existing ones.**
  - _Year check_, _ambiguous-prefix check_, _preserve release tags_, _legacy suffix cut_ - the four safety rules UmlautAdaptarrEX added on top of the .NET predecessor, now individually switchable. Two preset buttons flip them all at once: **Like the old Umlautadaptarr** and **Recommended values**.
  - Changes take effect on the next search; no restart and no re-sync needed.
- **Forward the \*Arr's User-Agent** (Settings → Advanced, off by default). Sends Sonarr/Radarr/Lidarr/Readarr's User-Agent to the indexer verbatim instead of ours, for indexers that only accept known client User-Agents or rate-limit by them. With it off the indexer sees only our token and no version fingerprint of your \*Arr.
- **Language plugins now state their cost** in Settings → Plugins and in the setup wizard: only enable a language you actually consume. Each extra plugin adds search variations, hence one more indexer request per search (hard cap 10, so German variants can get squeezed out), plus one more TheTVDB request per title per language on every sync. TMDB returns all languages in a single call and does not scale with the plugin count.

### Performance & robustness

- **Search hot path:** match variations are pre-normalized at index time instead of re-normalized on every incoming search request.
- **Bounded search fan-out:** variation searches per request are capped at 10 with a total deadline at 75% of the configured indexer timeout. The literal query and the canonical title always survive the cap; partial results are aggregated and returned normally. Previously an alias-heavy title against a slow indexer could make Sonarr/Radarr time out with nothing.
- **Proxy timeouts follow settings:** the Prowlarr proxy's HTTP timeouts now scale with `indexerTimeoutSeconds` (sized to cover the search route's worst case) instead of hardcoded 30s/60s values that could abort long-running searches the app would still have answered.
- **First-sync cache writes batched:** each title's cache writes run in one transaction (~4× fewer SQLite commits on a 5,000-item first sync), and cache write failures are now logged through the structured logger instead of `console.error`.
- **Composite database indexes** for the filtered history/log listings (`[level, createdAt]`, `[type, createdAt]`, `[domain, createdAt]`, `[mediaType, createdAt]`).
- **Boot hardening:** a corrupt search-item row no longer prevents startup or reindexing - bad rows are skipped and logged with samples; the boot query also fetches only the columns it needs.
- **Sync status hardening:** a failed status write (e.g. locked database) no longer discards a completed sync result; plugin seeding runs once per boot instead of on every settings save; the retention job runs `PRAGMA optimize` after cleanup.
- The proxy logs a warning when an indexer sends a non-GET request (which is forced to GET, matching long-standing wire behavior) instead of silently dropping the request body.

### Accessibility & i18n

- **Complete French and Swedish UI coverage:** 25 previously untranslated strings (Prowlarr patch flow, sync-runs filter) are now translated - all four locales carry the identical key set.
- Skip-to-content link, labeled navigation/stepper/charts, per-instance switch labels, keyboard- and touch-reachable error details (status badges, action-menu hints), `aria-describedby` on setup fields, `aria-sort` on sortable columns, and a shared alert primitive with correct `role="alert"`/`role="status"` semantics.

### Dependencies & internals

- Whole dependency stack refreshed within the supply-chain gate (`minimumReleaseAge`): Next 16.3.3, Fastify 5.12.1, Prisma 7.10.0, ESLint 10.9.1, Vitest 4.1.11, typescript-eslint 8.68.0, `@tanstack/react-query` 5.102.4 and others. Prisma stays on 7.x: its `latest` dist-tag currently points at an 8.0.0 release candidate.
- **The User-Agent follows the running version.** It was the hard-coded literal `UmlautAdaptarrEX/2.0` in three places - wrong ever since the 2.0 rewrite shipped as 1.x. `Setting.userAgent` is now an optional _override_: blank means `UmlautAdaptarrEX/<version>`, resolved exactly like the version shown in the Web UI, and the automatic value appears as the field's placeholder. The migration clears the untouched historical default so those installs move onto the automatic value; a customised User-Agent is left alone.
- **Behaviour change:** the outbound User-Agent is no longer the concatenation of the \*Arr's header and ours (`Sonarr/4.0.0 UmlautAdaptarrEX/2.0`). That value identified neither client and could defeat the very indexer allow-lists it looked like it was serving. It is now either ours (default) or the \*Arr's verbatim, controlled by the new toggle.
- Fastify's deprecated top-level `disableRequestLogging` (removed in Fastify 6) replaced with `LogController`, clearing a warning on every boot.
- The manual title override is now covered end-to-end against a real SQLite: save → override row → variations re-derived → in-memory index refreshed → the overridden title is what gets _queried_ → and a release named after it gets rewritten; delete restores the cached provider title. Two harness gaps closed along the way: `cleanDb()` never truncated `TitleOverride` (an override leaked into later tests), and the four message catalogues are now checked for key parity so a feature can no longer ship with an untranslated French/Swedish UI.

### Fixes

- **Silent failures:** failed list/settings loads now render an error state with a retry button instead of masquerading as "no entries" / an empty form; enabling/disabling an instance shows an error toast instead of silently snapping back; the setup wizard's admin step shows field validation errors instead of doing nothing on invalid input.
- **Sync-runs "Successful" filter never matched:** the filter sent `ok` while the database stores `success`. It works now.
- **Live logs reconnect automatically:** the WebSocket stream reconnects with exponential backoff (1s → 30s) after a server restart or dropped connection, with a "Reconnecting…" badge - previously the page silently sat on a dead stream until reload.
- **Instances API returns proper status codes:** PATCH/DELETE on a missing instance return 404, renaming onto an existing type+name returns 409 (previously both were 500).
- **Concurrent title-cache rechecks** are rejected with 409 instead of doubling all outbound provider calls.
- **Switching the UI language no longer discards unsaved settings edits** (the settings form no longer resets from a background refetch while dirty).
- **Version display under About** is trustworthy again: source builds no longer show an empty version, and the 2-day `:latest` security rebuild no longer changes the displayed string to `1.3.0-<sha>` even though the code is identical to the release ([#86](https://github.com/xpsony/UmlautAdaptarrEX/issues/86) - thanks [@Tom-Furrer](https://github.com/Tom-Furrer) for the report).
- **Spurious `FST_CSRF_MISSING_SECRET` 403 warnings:** the CSRF cookie could expire before the login session (e.g. after a browser restart), making the next action fail with a 403 and a scary-looking warning in the logs. CSRF cookies now live exactly as long as the session, and CSRF rejections are logged at debug level instead of warn ([#87](https://github.com/xpsony/UmlautAdaptarrEX/issues/87) - thanks [@Tom-Furrer](https://github.com/Tom-Furrer) for the report).
- **German titles that only exist as an alias were never searched.** A German production that Sonarr holds under its English TVDB translation ended up with no German title at all, and the alias list that _did_ carry the German name was only used to rewrite the response - never to query the indexer. Result: the indexers only ever saw the English title and found nothing, while a series whose German title came back as a proper translation worked fine. Three separate causes, all fixed:
  - The TVDB provider only read `/series/{id}/translations/deu`. It now also consults `/{type}/{id}/extended` for a still-missing language: the embedded `nameTranslations`, and - when `originalLanguage` proves it - the record's own primary `name`. The extra call is shared with the existing alias fallback, so a fully-resolved item costs nothing more.
  - Sonarr's own `alternateTitles` were discarded outright as soon as a provider returned a single alias (`??` instead of a merge). Both lists are now unioned, matching what Radarr has always done.
  - When no German title resolves at all, up to three Latin-script aliases are now promoted to _search_ variations. Bounded on purpose: the search issues one indexer request per variation with a hard cap of 10, and alias lists routinely carry a dozen non-Latin translations that would be pure noise and would push the useful queries out of that cap.
- **`TRUST_PROXY` hop counts are no longer silently ignored.** Fastify 5.12 disabled hop-count trust (a hop count cannot validate the immediate peer, so a client reaching the origin directly could spoof `X-Forwarded-*`). A numeric `TRUST_PROXY` now fails closed _and_ logs a warning at startup telling you to switch to `loopback` or a CIDR/IP list, instead of quietly trusting nothing.
- Docs: corrected the (false) global-rate-limit claim in `docs/api.md` and refreshed the per-route limits table against the code.

### Upgrade notes

- Five new database migrations (history retention setting, title overrides table, composite indexes, renaming options, User-Agent options) run automatically on first start - no manual action needed. The last one also adds a `SearchItem.imdbId` column and pins _Strip unwelcome characters_ and _Attach external ids_ to **off** for existing installations so your output does not change under you. Both are worth turning on - see Settings → Renaming.
- `SearchItem.imdbId` is filled by the next Radarr sync; until then movie items simply emit no `imdb` attribute.
- If your indexers were allow-listing or rate-limiting on the Sonarr/Radarr User-Agent, enable **Forward the \*Arr's User-Agent** in Settings → Advanced: outbound requests now carry only our own token by default.
- If you set `TRUST_PROXY` to a number, change it: use `loopback` (the default) or a comma-separated CIDR/IP list. The startup log now says so explicitly.
- No configuration changes required. The bounded search fan-out is a deliberate behavior improvement over the unbounded fan-out of earlier versions (and of the original UmlautAdaptarr); if you ever need to diagnose it, the server logs a warning with counts whenever the cap or deadline trims a search.
- New: a German/English comparison of UmlautAdaptarr vs. UmlautAdaptarrEX lives in `docs/comparison.de.md` / `docs/comparison.en.md`.

## 1.3.0 - 2026-07-26

Adds an optional headless mode for lean, UI-less deployments, fixes two rename/settings bugs, and refreshes the whole dependency stack. Headless is opt-in and off by default, so existing installs are unaffected. No schema changes, no configuration changes.

### Features

- **Headless mode:** setting `UMLAUTADAPTARREX_HEADLESS=1` runs the container without the Next.js Web UI and without the self-forking supervisor - a single Node process (Fastify + TCP proxy). In this project's Docker tests a minimally-configured container dropped from ~160 MiB (over 200 MiB with the Web UI open) to ~115 MiB headless, roughly a third / ~50-90 MB less depending on config. Only works for an already-configured instance (the setup wizard still runs exclusively in the Web UI); the container refuses to boot headless against an unconfigured database, with an explanatory error. When enabled, the Web UI port (default 5007) can be dropped from the compose port mapping.

### Fixes

- **Settings could no longer be saved when the proxy port is pinned by the environment:** with `UMLAUTADAPTARREX_PROXY_PORT` set, every save from the Settings page - on any tab, not just Advanced - was rejected with a `proxy-port-env-managed` conflict, because the form round-tripped the read-only, env-managed port value back to the server. The Web UI now omits the field entirely when the port is env-managed, and the server treats an unchanged value as a no-op instead of a conflict. Sending a _different_ value while the env var is set is still rejected with 409, so the "your edit would silently have no effect" guard stays intact.
- **Trailing punctuation leaked into renamed titles:** when the title variation that matched carried no parentheses but the release name did (e.g. variation "Chronicles of Time 2005" against `Chronicles.of.Time.(2005).S08E08...`), the closing `)` was left unconsumed and the rewrite emitted a doubled character - `Chronicles.of.Time.(2005).).S08E08...`. Closing delimiters (`)`, `]`, `}`) directly after the matched title are now skipped. Applies to both the movie/TV and the book/audiobook rename path; opening delimiters are deliberately left alone so a release named `Chronicles of Time(2005)...` still renames correctly.

### Security & maintenance

- **Dependency refresh:** the full stack bumped to current - Prisma `7.8.0` → `7.9.0` (client, CLI and the better-sqlite3 adapter), Next.js `16.2.10` → `16.2.11`, React `19.2.7` → `19.2.8`, argon2 `0.44.0` → `0.45.1`, nanoid `5.1.16` → `6.0.0`, better-sqlite3 `12.11.1` → `13.0.1`, undici `8.7.0` → `8.9.0`, recharts `3.9.2` → `3.10.0`, lucide-react `1.24.0` → `1.26.0`, react-hook-form `7.81.0` → `7.83.0`, next-intl `4.13.1` → `4.13.4`, fast-xml-parser `5.9.3` → `5.10.1`, ws `8.21.0` → `8.21.1`, `@fastify/cookie` `11.1.0` → `11.1.2`, `@tanstack/react-query` `5.101.2` → `5.101.4`, the Radix UI set, plus dev tooling (ESLint `10.8.0`, Prettier `3.9.6`, typescript-eslint `8.65.0`, Playwright `1.62.0`, Vite `8.1.5`, Tailwind `4.3.3`, postcss `8.5.23`, tsx `4.23.1`, autoprefixer `10.5.4`, concurrently `10.0.4`). TypeScript stays on the 6.x line (7.0 breaks the current type-check).
- **CI & dependency automation:** `actions/setup-node` bumped to v7. Dependabot now applies a 3-day cooldown on all ecosystems, so freshly-published releases are not pulled in immediately, and auto-merge no longer needs a PR approval - it gates on the status check alone.

### Upgrade notes

- No action needed - this release has no schema changes and no configuration changes. Headless mode is opt-in and off by default; to use it, complete the setup wizard once with the Web UI enabled, then set `UMLAUTADAPTARREX_HEADLESS=1` and restart. Remove the variable temporarily whenever you need to change configuration in the Web UI.

## 1.2.5 - 2026-07-10

A maintenance release: all dependencies and the build toolchain are refreshed, CI and the dev container move to Node 26 (the production image already ran Node 26), and an automated Docker security rebuild keeps the published `:latest` image patched with OS/base-image security updates between releases. No schema changes, no configuration changes.

### Improvements

- **Automatic Docker security rebuilds:** a scheduled workflow (`.github/workflows/security-rebuild.yml`) now rebuilds the latest stable release image every 2 days with a fresh base image and OS packages (`pull` + `no-cache`), so `:latest` picks up Debian/Node security patches without waiting for a new release. It publishes `:latest` and a `:<version>-<sha>` variant; the immutable `:<version>` tag from the release build is left untouched.

### Security & maintenance

- **Dependency refresh:** all dependencies bumped to their latest patch/minor - pnpm `11.3.0` → `11.11.0`, Fastify `5.8.5` → `5.10.0`, Next.js `16.2.9` → `16.2.10`, recharts `3.8.1` → `3.9.2`, lucide-react `1.21.0` → `1.24.0`, undici `8.5.0` → `8.7.0`, the Radix UI set, plus dev tooling (ESLint `10.6.0`, Vitest `4.1.10`, Vite `8.1.4`, Prettier `3.9.4`, tsx `4.23.0`, typescript-eslint `8.63.0`, Playwright `1.61.1`). TypeScript stays on the 6.x line (7.0 breaks the current type-check). `pnpm audit --prod` reports no known vulnerabilities in the shipped runtime dependencies.
- **Node 26 across the board:** CI and the dev container now run on Node 26, matching the production image; the server bundle now targets Node 24. GitHub Actions bumped (`actions/checkout` v7, `actions/cache` v6).
- **Dependency PRs target `dev`:** Dependabot now opens against the `dev` branch instead of `main`, so updates land on the active branch and auto-merge after CI (patch/minor; majors stay manual) - removing the `main`→`dev` back-merge.

### Upgrade notes

No action needed - this release has no schema changes and no configuration changes.

## 1.2.4 - 2026-06-21

A stability and hardening release: title-provider syncs and the supervisor no longer hang on stalled connections, the indexer proxy and the admin/setup endpoints are hardened, and several title-matching and Web UI bugs are fixed. No schema changes.

### Fixes

- **Operation-mode descriptions show the configured ports** ([#30](https://github.com/xpsony/UmlautAdaptarrEX/issues/30)): the operation-mode texts in the setup wizard and Settings → Operation mode hard-coded `5005`/`5006` even when the ports had been remapped via `UMLAUTADAPTARREX_LEGACYAPI_PORT` / `UMLAUTADAPTARREX_PROXY_PORT`. They now interpolate the resolved ports (env override > stored/default). Thanks to [xopez](https://github.com/xopez) for reporting.
- **Sync no longer hangs on a stalled provider:** TVDB, pcjones and TMDB requests now carry request timeouts (`bodyTimeout`/`headersTimeout`), so a single unresponsive title provider can no longer block one of the bulk lookup slots - and therefore the whole sync - indefinitely.
- **One bad provider no longer aborts the chain:** each provider in the configured order is now isolated; a provider that throws (e.g. pcjones on a network error) is logged and skipped so the remaining providers still contribute, instead of discarding already-merged results.
- **Title matching:** titles containing tabs or line breaks are no longer collapsed into a single word (whitespace is normalized before stripping), and leading articles (`Der`/`Die`/`Das`/`The`/…) are now stripped case-insensitively, so lowercase or all-caps titles produce the same search variations as title-cased ones. `getReadarrTitleForExternalId` now strips the active language pack's articles instead of only the English "the".
- **Boot & restart robustness:** `runPrismaMigrate` now attaches an `error` handler (and uses `process.execPath`), so a failed `prisma migrate deploy` launch surfaces an error instead of hanging the boot forever. The supervisor now tracks the Next.js child's real exit, so a process that ignores `SIGTERM` is actually `SIGKILL`-ed within the grace window and can no longer orphan the Web UI port on restart. The admin Restart endpoint now ties teardown to the response being flushed instead of a fixed 250 ms timer.

### Improvements

- **Indexer proxy hardening:** the plain-HTTP relay path now restricts targets to ports 80/443 (matching the HTTPS-CONNECT allow-list), destroys upstream/client sockets on error or clean close, and adds a 120 s idle timeout - closing an SSRF / open-relay gap and a socket leak.
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

No action needed - this release has no schema changes and no configuration changes.

## 1.2.3 - 2026-06-06

Lets the container run fully unprivileged and ships as a TrueNAS Community app. Until now the image required root at startup; root is now used only for the one-time `/data` ownership fix and the application process never runs as root. No schema changes.

### Features

- **TrueNAS Community app:** UmlautAdaptarrEX is now available in the TrueNAS app catalog ([apps.truenas.com/catalog/umlautadaptarrex_community](https://apps.truenas.com/catalog/umlautadaptarrex_community/)) - search for "UmlautAdaptarrEX" under Apps → Discover Apps to install. The app is maintained by [xopez](https://github.com/xopez), many thanks.

### Improvements

- **Unprivileged container startup:** The image can now be started directly as a non-root user (`docker run --user`, a compose `user:` entry, Kubernetes `runAsUser`, or the TrueNAS app's `run_as` field). In that case the entrypoint skips the `chown`/`gosu` step and runs directly under the given UID/GID, so the container no longer needs the `CHOWN`/`SETUID`/`SETGID` capabilities or root, provided the `/data` volume is already owned by that UID/GID.

### Security & maintenance

- **root only for ownership setup:** When the container does start as root (the default), root is used **only** for the one-time `chown` of `/data`; the entrypoint then drops to `PUID:PGID` via `gosu` before launching the app, so the application process (`node start.mjs`) never runs as root. The startup path is fully backward-compatible with the existing root-by-default compose setup.

### Upgrade notes

No action needed for the default Docker / compose setup. To run unprivileged, pre-own the `/data` volume with your target UID/GID and start the container with that user (e.g. `--user 1000:1000`); `PUID`/`PGID` are ignored in that mode since the orchestrator already sets the UID/GID.

## 1.2.2 - 2026-06-05

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
- **Dependencies updated:** All pnpm packages bumped to their latest patch/minor releases - Next.js `16.2.7`, React / React-DOM `19.2.7`, `@tanstack/react-query` `5.101.0`, plus dev tooling (`eslint-config-next`, `typescript-eslint`, `concurrently`, `@types/react`). No behaviour changes; `pnpm audit` reports no known vulnerabilities.

### Upgrade notes

The new `AdminUser.lastSeenChangelog` column is applied automatically by `prisma migrate deploy` on start. If you relied on the `PORT` or `WEB_PORT` environment variables, switch to `UMLAUTADAPTARREX_LEGACYAPI_PORT` / `UMLAUTADAPTARREX_WEBUI_PORT`.

## 1.2.1 - 2026-06-02

Lets you set all three service ports through environment variables before the first start, so Docker users can avoid host port clashes without editing the app. No schema changes.

### Features

- **Configurable service ports:** New environment variables `UMLAUTADAPTARREX_LEGACYAPI_PORT` (Fastify API + legacy indexer API + log stream, default `5005`), `UMLAUTADAPTARREX_WEBUI_PORT` (Web UI, default `5007`) and `UMLAUTADAPTARREX_PROXY_PORT` (Prowlarr indexer proxy, default `5006`). The compose files and `.env.example` pick these up, so a single value moves both the container bind port and the published host port. The existing `PORT` and `WEB_PORT` variables keep working as fallbacks.

### Improvements

- **Env-managed proxy port:** When `UMLAUTADAPTARREX_PROXY_PORT` is set it overrides the stored proxy port at every start, and the proxy-port field under Settings → Advanced is shown read-only with a hint so the value cannot drift out of sync. The live-log view and the proxy URL advertised to Prowlarr both follow the configured ports automatically.

## 1.2.0 - 2026-06-02

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

## 1.1.1 - 2026-05-25

### Fixes

- **Lidarr/Readarr sync no longer crashes on duplicate album/book titles:** Library rows are now keyed by `normalize("{artist} {album}")` for Lidarr and `normalize("{book} {author}")` for Readarr instead of just the album/book title. Previously libraries with multiple albums or books sharing a title across artists/authors ("Greatest Hits", "Live", "Best Of", "Self-Titled", …) collided on the SearchItem unique constraint and aborted the sync with Prisma `P2002`. As a side effect the legacy `/api?t=search&cat=3000…` `getByExternalId` lookup now actually resolves, because Prowlarr's `?q=Artist Album` query normalizes to the same key the row was stored under.
- **Sync dedup defense-in-depth:** `persistAndReindex` now deduplicates items by externalId before writing, so a stray duplicate in the upstream payload no longer aborts a 50-item chunk transaction. Duplicates are counted and warned in the log; `SyncRun.itemsCount` reflects the deduped count.
- **Scheduler provider gate:** `POST /api/admin/sync` and the scheduled tick no longer return `no_provider` for Lidarr/Readarr-only setups. The gate now only blocks when at least one Sonarr/Radarr instance is enabled, because only those two consult a title provider during sync.

### Upgrade notes

No manual resync required. On the next sync (automatic or via "Sync now" in the dashboard) the stale rows with old externalIds are removed

## 1.1.0 - 2026-05-25

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
