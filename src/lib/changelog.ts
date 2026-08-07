export type ChangelogItemType = "feature" | "improvement" | "fix";

export interface ChangelogItem {
  type: ChangelogItemType;
  text: string;
}

export interface ChangelogEntry {
  /** Free-form version label, also used as the localStorage key for "seen" state. */
  version: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Highlight on the all-news page (e.g. major releases). */
  highlight?: boolean;
  title: string;
  description?: string;
  items: ChangelogItem[];
}

/**
 * Newest entry first. Append new releases to the top of the array.
 * The first entry's `version` drives the auto-popup dialog.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.4.0",
    date: "2026-08-07",
    highlight: true,
    title: "1.4.0: Library browser with manual title overrides, big table & performance update",
    description:
      "The biggest release since the rewrite: a new Library page finally makes the synced titles visible and lets you fix individual mismatches with manual overrides. All list pages gain sorting, deep-linkable filters, detail views and CSV export. Under the hood: faster searches on large libraries, bounded search fan-out, and a full accessibility & translation pass.",
    items: [
      {
        type: "feature",
        text: "New Library page: browse every synced title (original ↔ resolved German title, all search variations) across all instances, with search, filters (instance, media type, missing German title) and pagination. This data previously lived only in the logs.",
      },
      {
        type: "feature",
        text: "Manual title overrides: fix a single mismatched title straight from the Library detail view. Overrides apply to all instances, survive re-syncs and item removal, and search variations recompute immediately — no more clearing the whole title cache for one bad match. Removing an override restores the provider title.",
      },
      {
        type: "feature",
        text: "Sortable columns on request history, rename history, sync runs and the library — and filters, page and sorting now live in the URL, so reload, back button and deep links reproduce exactly the view you had.",
      },
      {
        type: "feature",
        text: "Sync runs: server-side pagination with free-text search and a status filter — the old 200-run display cap is gone. (Also fixed: the “Successful” filter option never matched anything.)",
      },
      {
        type: "feature",
        text: "Row detail views for request history and sync runs: click any row to see the full query string, complete error messages and per-provider counters; an open sheet live-updates while a sync is running.",
      },
      {
        type: "feature",
        text: "CSV export for request and rename history — respects the current filter and sorting, Excel-safe (UTF-8 BOM so umlauts survive, spreadsheet formula injection neutralized), capped at 10,000 rows.",
      },
      {
        type: "feature",
        text: "Instances list: per-row “Test connection” and “Sync now” actions. Connection tests now run through a server-side endpoint, so instance API keys no longer round-trip through the browser.",
      },
      {
        type: "feature",
        text: "Request history and rename history paginate through all stored entries (page size 25/50/100/250) with server-side search across the whole retained period — previously search only covered the newest rows. The new “History retention (days)” setting (Settings → Advanced, default 30, 1–365) cleans up old entries automatically every 6 hours. Thanks to Tom-Furrer for reporting the search limitation (#115).",
      },
      {
        type: "improvement",
        text: "Settings tabs are now independent forms: editing one tab no longer lights up the save button on the others, saves send only the fields of that tab, and the browser warns before closing with unsaved changes. Switching the UI language no longer reloads the page — and no longer discards unsaved edits.",
      },
      {
        type: "improvement",
        text: "Faster and more predictable searches on large libraries: match variations are pre-computed instead of re-normalized on every request, variation fan-out per search is capped at 10 with a total deadline at 75% of the configured indexer timeout (your literal query and the canonical title are always searched), and the Prowlarr proxy timeouts now scale with that setting instead of a hardcoded 30s — no more Sonarr/Radarr timeouts on title-alias-heavy items.",
      },
      {
        type: "improvement",
        text: "Robustness: first-sync title-cache writes are batched (~4× fewer database commits), new composite indexes speed up filtered history/log views, a corrupt cache row no longer prevents startup, and a failed status write no longer loses a completed sync result.",
      },
      {
        type: "improvement",
        text: "Accessibility & translations: complete French and Swedish UI coverage (25 missing strings translated), skip-to-content link, screen-reader labels for navigation, charts and per-instance switches, keyboard- and touch-reachable error details, and live-log streaming now reconnects automatically after a connection drop.",
      },
      {
        type: "fix",
        text: "A batch of silent-failure fixes: failed list or settings loads now show an error with a retry button instead of pretending to be empty, enabling/disabling an instance reports errors instead of silently snapping back, and the setup wizard shows field validation errors instead of doing nothing on an invalid submit.",
      },
      {
        type: "fix",
        text: 'The version under About is trustworthy again. Images built from source showed an empty version, and the automatic :latest security rebuild (every 2 days) changed the displayed string to something like 1.3.0-881f830 although the code was identical to the release. Both now show the plain release version. Note that if About still shows an older version after an update, the container was not replaced: "docker compose pull" only downloads the image, "docker compose up -d" recreates the container from it. Thanks to Tom-Furrer for the report (#86).',
      },
      {
        type: "fix",
        text: "No more spurious FST_CSRF_MISSING_SECRET 403 warnings in the logs: the CSRF cookie could expire before the login session (e.g. after a browser restart), making the next action fail with a 403. CSRF cookies now live exactly as long as the session, and CSRF rejections are logged at debug level instead of warn. Thanks to Tom-Furrer for the report (#87).",
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-26",
    title: "1.3.0: Headless mode — run without the Web UI to save memory",
    description:
      "Adds an optional headless mode for lean, UI-less deployments: setting UMLAUTADAPTARREX_HEADLESS=1 runs the container without the Next.js Web UI (and without the self-forking supervisor) as a single process. Also fixes saving the settings when the proxy port is pinned by an environment variable, and a punctuation glitch in renamed titles. Headless is opt-in and off by default, so existing installs are unaffected. No database changes.",
    items: [
      {
        type: "feature",
        text: "Headless mode (UMLAUTADAPTARREX_HEADLESS=1): run without the Next.js Web UI and without the self-forking supervisor — a single Node process (Fastify + TCP proxy). In Docker tests a minimally-configured container dropped from ~160 MiB (over 200 MiB with the Web UI open) to ~115 MiB headless, roughly a third / ~50–90 MB less depending on config. Only works for an already-configured instance (the setup wizard still runs exclusively in the Web UI); the container refuses to boot headless against an unconfigured database with an explanatory error. When enabled, the Web UI port (default 5007) can be dropped from the compose port mapping.",
      },
      {
        type: "fix",
        text: "Settings can be saved again when the proxy port is pinned by UMLAUTADAPTARREX_PROXY_PORT: saving from any settings tab failed with a conflict error, because the form sent the read-only, environment-managed port value back to the server. The field is now left out of the request, and an unchanged value is accepted as a no-op. Setting a different port while the environment variable is active is still refused — it would have no effect anyway.",
      },
      {
        type: "fix",
        text: 'Renamed titles no longer pick up a stray bracket: when the matching title alias had no parentheses but the release name did (e.g. alias "Chronicles of Time 2005" vs. release Chronicles.of.Time.(2005).S08E08…), the closing bracket was duplicated into the result — Chronicles.of.Time.(2005).).S08E08…. Affects movie/series and book/audiobook renaming.',
      },
      {
        type: "improvement",
        text: "Dependency refresh: the whole stack bumped to current — Prisma 7.9, Next.js 16.2.11, React 19.2.8, argon2 0.45.1, nanoid 6, undici 8.9, recharts 3.10, lucide-react 1.26, next-intl 4.13.4, plus the Radix UI set and the dev tooling (ESLint 10.8, Prettier 3.9.6, Playwright 1.62). Dependabot now waits 3 days before proposing a freshly-published release.",
      },
    ],
  },
  {
    version: "1.2.5",
    date: "2026-07-10",
    title: "1.2.5: Maintenance — dependency refresh & automatic security rebuilds",
    description:
      "A maintenance release: all dependencies and the build toolchain refreshed, CI and the dev container moved to Node 26 (the production image already ran Node 26), and the published Docker :latest image is now automatically rebuilt every 2 days to pick up OS security patches between releases. No database changes.",
    items: [
      {
        type: "improvement",
        text: "The published Docker :latest image is now automatically rebuilt every 2 days with a fresh base image and OS packages, so it picks up Debian/Node security patches without waiting for a new release.",
      },
      {
        type: "improvement",
        text: "Dependency refresh: all packages bumped to their latest patch/minor — pnpm 11.11.0, Fastify 5.10.0, Next.js 16.2.10, recharts 3.9.2, lucide-react 1.24.0, undici 8.7.0, the Radix UI set, plus dev tooling (ESLint, Vitest, Vite, Prettier, tsx, Playwright). No known vulnerabilities in the shipped runtime dependencies.",
      },
      {
        type: "improvement",
        text: "Tooling: CI and the dev container now run on Node 26 (matching the production image) and the GitHub Actions were bumped; Dependabot dependency PRs now target the dev branch and auto-merge after CI.",
      },
    ],
  },
  {
    version: "1.2.4",
    date: "2026-06-21",
    title: "1.2.4: Stability & hardening — providers, proxy and matching fixes",
    description:
      "A stability and hardening release: title-provider syncs and the supervisor no longer hang on stalled connections, the indexer proxy and the admin/setup endpoints are hardened, and several title-matching and Web UI bugs are fixed. No database changes.",
    items: [
      {
        type: "fix",
        text: "Operation-mode descriptions now show the actually-configured ports: the mode texts in the setup wizard and Settings → Operation mode no longer hard-code 5005/5006 but use the resolved ports (UMLAUTADAPTARREX_*_PORT override > stored/default). Thanks to xopez (github.com/xopez) for reporting (#30).",
      },
      {
        type: "fix",
        text: "Title-provider syncs are more reliable: TVDB, pcjones and TMDB requests now have timeouts, so a single unresponsive provider can no longer hang a sync indefinitely.",
      },
      {
        type: "fix",
        text: "A failing title provider is now skipped so the remaining providers still contribute, instead of one error aborting the whole lookup chain mid-sync.",
      },
      {
        type: "improvement",
        text: "TVDB: concurrent lookups now share a single login instead of each firing its own, removing redundant logins and a token-refresh race that could drop titles during a large sync.",
      },
      {
        type: "fix",
        text: 'Title matching: titles containing tabs or line breaks are no longer collapsed into a single word, and leading articles (Der/Die/Das/The/…) are now stripped regardless of capitalization, so lowercase titles produce the same search variations. Readarr external-ID titles now strip the configured language\'s articles, not just English "the".',
      },
      {
        type: "fix",
        text: "Startup and restart are more robust: a failed database migration launch now reports an error instead of hanging the boot forever, and a Web UI process that ignores the shutdown signal is now force-stopped so the Web UI port can no longer get stuck on restart. The admin Restart now waits for its response to be sent before tearing down.",
      },
      {
        type: "improvement",
        text: "Indexer proxy hardening: the plain-HTTP relay path now only allows ports 80/443 (matching the HTTPS-CONNECT path), cleans up its sockets and adds an idle timeout — closing an SSRF / open-relay gap and a socket leak.",
      },
      {
        type: "improvement",
        text: "Security: the unauthenticated setup-status endpoint is now rate-limited and no longer discloses the Prowlarr host or proxy username once setup is complete (the API key was never exposed). The Prowlarr admin actions (preview/import/test/save) are now rate-limited too.",
      },
      {
        type: "improvement",
        text: 'Lower database load on large installs: the session last-used timestamp is now updated at most once every 5 minutes instead of on every request, and "Recheck missing titles" scans the cache in bounded batches instead of loading the whole table into memory at once. Request-history entries also cap the stored domain/query length.',
      },
      {
        type: "fix",
        text: "Web UI: fixed a race when closing the Prowlarr-import dialog while it was still loading, a double-submit window on import, and live-log rows shifting/flickering as new lines arrive. The dashboard and instances pages now show a clear error with a retry button when a request fails, instead of looking empty.",
      },
      {
        type: "improvement",
        text: "Security: added a Content-Security-Policy header, and generated passwords now use only cryptographically-secure randomness (no weak fallback, no character bias). Secret-mask detection was tightened so a real stored secret is never mistaken for the mask, while Prowlarr's asterisk masking is still recognized.",
      },
    ],
  },
  {
    version: "1.2.3",
    date: "2026-06-06",
    title: "1.2.3: TrueNAS app & unprivileged (non-root) container startup",
    description:
      "UmlautAdaptarrEX is now available as a TrueNAS Community app, and the container can run fully unprivileged. root is used only for the one-time /data ownership fix and the app process never runs as root. No database changes.",
    items: [
      {
        type: "feature",
        text: 'UmlautAdaptarrEX is now available in the TrueNAS app catalog — search for "UmlautAdaptarrEX" under Apps → Discover Apps to install. The app is maintained by xopez (github.com/xopez), many thanks.',
      },
      {
        type: "improvement",
        text: "The image can now be started directly as a non-root user (docker run --user, a compose user: entry, Kubernetes runAsUser, or the TrueNAS app's run_as field). In that case the entrypoint skips the chown/gosu step and runs directly under the given UID/GID, so the container no longer needs the CHOWN/SETUID/SETGID capabilities or root, provided the /data volume is already owned by that UID/GID.",
      },
      {
        type: "improvement",
        text: "Security: when the container does start as root (the default), root is used only for the one-time chown of /data; the entrypoint then drops to PUID:PGID via gosu before launching the app, so the application process never runs as root. Fully backward-compatible with the existing root-by-default setup.",
      },
    ],
  },
  {
    version: "1.2.2",
    date: "2026-06-05",
    title: "1.2.2: Proxmox LXC installer, ports in the UI & setup fixes",
    description:
      "Adds a one-line Proxmox LXC installer, surfaces the actual service ports in the UI, and fixes API proxying and the setup flow behind Docker NAT. No manual migration needed beyond applying the new database migration on start.",
    items: [
      {
        type: "feature",
        text: "New Proxmox VE community-script installer: a one-line command creates an LXC container, installs UmlautAdaptarrEX and prompts for the service ports during setup. Still in development and not yet fully tested, see the README before using it.",
      },
      {
        type: "feature",
        text: "Settings → Advanced now shows the active Fastify API port and Web UI port read-only alongside the editable proxy port, so you can see the actually bound ports without inspecting the environment.",
      },
      {
        type: "improvement",
        text: "The what's-new dialog is now tracked per admin account in the database instead of per browser. Each user sees it exactly once and, after confirming, it stays dismissed across browsers and devices until a newer release ships.",
      },
      {
        type: "improvement",
        text: "Service ports are now read only from the branded UMLAUTADAPTARREX_LEGACYAPI_PORT / UMLAUTADAPTARREX_WEBUI_PORT / UMLAUTADAPTARREX_PROXY_PORT variables. The legacy PORT and WEB_PORT fallbacks (still accepted in 1.2.1) have been removed; the compose files and .env.example already use the branded names.",
      },
      {
        type: "fix",
        text: "The Web UI now reverse-proxies /api/* at runtime instead of baking the API port into the build. A custom UMLAUTADAPTARREX_LEGACYAPI_PORT no longer left /api/health and the *Arr icons failing with ECONNREFUSED, and the *Arr icons are no longer redirected to /setup during the wizard.",
      },
      {
        type: "fix",
        text: "First-run setup behind Docker NAT works again: the pre-setup instance test no longer hard-blocks private/LAN targets by default but follows the SSRF-strict toggle, so connecting to Sonarr/Radarr on the same LAN succeeds out of the box (strict mode still restores loopback-only for cloud or multi-tenant operators).",
      },
      {
        type: "improvement",
        text: "Security hardening: the /api/auth/me session check is now rate-limited per IP",
      },
      {
        type: "improvement",
        text: "Dependencies updated to their latest patch/minor releases (Next.js 16.2.7, React 19.2.7, TanStack Query 5.101, plus dev tooling). No behaviour changes; pnpm audit reports no known vulnerabilities.",
      },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-06-02",
    title: "1.2.1: Configurable service ports via environment variables",
    description:
      "You can now set all three service ports before the first start through environment variables, so Docker users can avoid host port clashes without editing the app. No database changes.",
    items: [
      {
        type: "feature",
        text: "New environment variables UMLAUTADAPTARREX_LEGACYAPI_PORT (Fastify API + legacy indexer API + log stream, default 5005), UMLAUTADAPTARREX_WEBUI_PORT (Web UI, default 5007) and UMLAUTADAPTARREX_PROXY_PORT (Prowlarr indexer proxy, default 5006). The compose files and .env.example pick these up so a single value moves both the container bind port and the published host port. The existing PORT and WEB_PORT variables keep working as fallbacks.",
      },
      {
        type: "improvement",
        text: "When UMLAUTADAPTARREX_PROXY_PORT is set it overrides the stored proxy port at every start, and the proxy-port field under Settings, Advanced is shown read-only with a hint so the value cannot drift out of sync. The live-log view and the proxy URL advertised to Prowlarr both follow the configured ports automatically.",
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-02",
    title: "1.2.0: Prowlarr indexer patching, dependency refresh & Docker healthcheck fix",
    description:
      "Adds a dialog to patch your Prowlarr indexers for UmlautAdaptarrEX, plus a dependency refresh and a container healthcheck fix. No database changes.",
    items: [
      {
        type: "feature",
        text: 'New Prowlarr indexer-patch dialog: lists your Prowlarr indexers and lets you select which ones to patch for UmlautAdaptarrEX. Patching tags the indexer with "umlautadaptarrex" and switches its Prowlarr base URL from https:// to http:// so requests flow through the local proxy and titles get rewritten; de-selecting reverts both. Available in the setup wizard and any time under Settings → Prowlarr. The dialog explains why the switch is needed and that the connection to the indexer itself stays HTTPS, so no unencrypted traffic leaves your system.',
      },
      {
        type: "improvement",
        text: "Refreshed all dependencies to their latest versions, including next-intl, react-hook-form, lucide-react and the build tooling (ESLint, Vitest, Vite, tsx, concurrently). Typecheck, lint, the full test suite and the production build all pass on the updated versions.",
      },
      {
        type: "fix",
        text: "Fixed the Docker container healthcheck so it reliably probes /api/health and discards the response body instead of depending on wget's --spider mode, which behaves inconsistently across some BusyBox builds.",
      },
      {
        type: "fix",
        text: "Running the app without Docker (pnpm prod) now starts correctly: the supervisor finds the Next.js standalone server on bare-metal installs and assembles its static assets next to it on boot, so no manual copy step is needed.",
      },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-05-25",
    title: "1.1.1: Lidarr/Readarr sync fix",
    description:
      "Restores the Lidarr and Readarr sync against libraries that contain albums or books with identical titles across different artists/authors, and lets Lidarr/Readarr-only setups sync without a title provider configured.",
    items: [
      {
        type: "fix",
        text: "Lidarr and Readarr sync no longer crashes with a unique-constraint error when the library has albums or books sharing a title across different artists or authors (Greatest Hits, Live, Best Of, Self-Titled, …). The cache key now combines artist and album (Lidarr) or book and author (Readarr) so identical titles from different artists/authors can no longer collide.",
      },
      {
        type: "fix",
        text: 'Music and book searches via the legacy indexer route now find the cached library row again. Previously the lookup was effectively dead because Prowlarr sends "artist album" / "book author" as the query, but the row was stored under just the album/book title.',
      },
      {
        type: "fix",
        text: "Setups with only Lidarr and/or Readarr instances enabled can now sync without a title provider configured. Sonarr/Radarr still require a provider as before.",
      },
      {
        type: "improvement",
        text: "Sync persistence is hardened against duplicate items in a single fetch: duplicates are dropped with a warning instead of aborting a 50-item chunk transaction.",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-05-25",
    title: "1.1.0: Hardening, sync performance & maintenance release",
    description:
      "Security hardening for admin auth and secret handling, a major sync performance upgrade that parallelises instance syncs and title-provider lookups, more resilient title providers and sync scheduler, TVDB credentials configurable in the UI, plus a dependency refresh.",
    items: [
      {
        type: "feature",
        text: "TVDB API key and subscriber PIN can now be configured both in the setup wizard and on the admin settings page. Credentials are stored masked, can be tested live before saving, and use the same reusable secret-field UI as TMDB.",
      },
      {
        type: "improvement",
        text: "Sync is now parallelised end-to-end: enabled Sonarr/Radarr/Lidarr/Readarr instances sync concurrently, Lidarr/Readarr fetch albums/books in parallel batches, and TMDB/TVDB bulk lookups run in batches at safe rate limits (TMDB 20 req/s, TVDB 10 req/s) instead of one request at a time. Large libraries sync several times faster.",
      },
      {
        type: "improvement",
        text: "Title-provider rate limiter rewritten to be safe under parallelism: concurrent lookups no longer race past the configured request interval, so the new bulk batching stays comfortably below TMDB's and TVDB's request budgets.",
      },
      {
        type: "improvement",
        text: "Sync writes go to the database in small chunks instead of one giant transaction, so concurrent instance syncs interleave on SQLite and a mid-sync interruption keeps most of the progress.",
      },
      {
        type: "fix",
        text: "Admin login now rotates the session ID, runs a constant-time check for unknown users, awaits the CSRF gate before the route handler runs, and forces Secure cookies on any HTTPS request.",
      },
      {
        type: "fix",
        text: "API keys, passwords and Prowlarr secrets are now redacted from logs (including the live log stream and legacy-route logs) and masked in admin responses; the /api/health endpoint no longer exposes process uptime.",
      },
      {
        type: "fix",
        text: "Setup wizard handles concurrent completions, rejects unknown plugin IDs up-front and no longer issues outbound probes (Prowlarr connect) before authentication is in place.",
      },
      {
        type: "improvement",
        text: "TMDB bulk lookups use Promise.allSettled so a single failing ID no longer aborts the batch; TVDB has a retry guard against 401 token-refresh loops; rate limiter clamps negative Retry-After values.",
      },
      {
        type: "improvement",
        text: "Sync scheduler has a watchdog that detects stuck runs and unblocks the queue instead of waiting forever.",
      },
      {
        type: "improvement",
        text: "Refreshed third-party dependencies (React Query, react-hook-form, Tailwind, undici, ws, fast-xml-parser, lru-cache and others) to their latest minor and patch versions.",
      },
      {
        type: "improvement",
        text: "Upgraded build tooling (pnpm 11.3.0, ESLint 10, Vitest 4.1.7, Playwright 1.60, tsx 4.22.3) and pinned the React version in the ESLint config.",
      },
      {
        type: "improvement",
        text: "Docker image rebuilds faster thanks to a reworked Dockerfile with better layer caching and refreshed base image references. The build context also includes the pnpm workspace file so the install step no longer fails inside the image.",
      },
      {
        type: "fix",
        text: "Added explicit Buffer type annotations to socket data handlers in the TCP proxy tests so the suite passes under stricter TypeScript settings.",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-05-08",
    highlight: true,
    title: "UmlautAdaptarrEX 1.0: First public release",
    description:
      "Full rewrite of the .NET predecessor on Next.js + Fastify + Prisma with a web UI, Prowlarr integration and multi-language support.",
    items: [
      {
        type: "feature",
        text: "New admin web UI: dashboard with live KPIs, request and rename charts, sync history, live log viewer, and searchable request/rename history pages.",
      },
      {
        type: "feature",
        text: "First-run setup wizard with Prowlarr import: Sonarr, Radarr, Lidarr and Readarr are auto-discovered and pulled in.",
      },
      {
        type: "feature",
        text: "HTTP proxy on port 5006 with Basic Auth, no per-tracker indexer entries required anymore.",
      },
      {
        type: "feature",
        text: '"Install in Prowlarr" button: creates the indexer-proxy entry and a tag automatically in Prowlarr.',
      },
      {
        type: "feature",
        text: "Operation-mode switch: proxy only (5006), legacy indexer API only (5005), or both at the same time.",
      },
      {
        type: "feature",
        text: "Plugin system for language-specific title variants, with built-in plugins for German, Swedish and French.",
      },
      {
        type: "feature",
        text: "Multi-language UI in German, English, Swedish and French.",
      },
      {
        type: "feature",
        text: "Persistent history pages: requests, renames and sync runs are stored in the database, searchable and filterable.",
      },
      {
        type: "feature",
        text: "Application API key and proxy password can be regenerated from the UI.",
      },
      {
        type: "improvement",
        text: "TMDB provider as fallback to the pcjones Title API for multi-language coverage.",
      },
      {
        type: "improvement",
        text: "Indexer rate limiter with dynamic backoff (Retry-After), protects free-tier indexers and avoids 429s.",
      },
      {
        type: "improvement",
        text: "Session-based admin auth with CSRF protection; sensitive fields (API keys, passwords) are auto-redacted in logs.",
      },
      {
        type: "improvement",
        text: "Database-backed title cache: provider responses are reused so syncs only query unknown titles.",
      },
    ],
  },
];

export function latestChangelog(): ChangelogEntry | null {
  return CHANGELOG[0] ?? null;
}

/**
 * Returns the entries newer than `lastSeenVersion` (newest first).
 * If the version is unknown (e.g. user upgraded across many releases or the
 * stored value is stale), only the latest entry is returned to avoid
 * dumping the entire history.
 */
export function unseenSince(lastSeenVersion: string | null | undefined): ChangelogEntry[] {
  if (!lastSeenVersion) return [];
  const idx = CHANGELOG.findIndex((e) => e.version === lastSeenVersion);
  if (idx === -1) {
    const latest = latestChangelog();
    return latest ? [latest] : [];
  }
  return CHANGELOG.slice(0, idx);
}
