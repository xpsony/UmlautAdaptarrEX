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
