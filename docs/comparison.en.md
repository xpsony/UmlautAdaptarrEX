# UmlautAdaptarr vs. UmlautAdaptarrEX

> 🇩🇪 Deutsche Version: [comparison.de.md](comparison.de.md)

**UmlautAdaptarr** (by [PCJones](https://github.com/PCJones/UmlautAdaptarr)) solved a problem
that had plagued German-language Sonarr/Radarr setups for years: releases with umlauts and
German titles are not reliably found and matched by the *arrs. The core concept — a proxy
that expands searches with title variations and rewrites release titles for matching —
originates from that project, and UmlautAdaptarrEX would not exist without it. EX also still
uses PCJones' title API as one of its title providers.

**UmlautAdaptarrEX** is a ground-up reimplementation of that idea (TypeScript,
Next.js + Fastify + SQLite instead of .NET), with the goal of evolving the concept into an
actively maintained product with a web interface, diagnostic tooling, and a modern
operations story.

## At a glance

|                                                     | UmlautAdaptarr                | UmlautAdaptarrEX                                               |
| --------------------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| Core principle (proxy + title variations + rewrite) | ✅                            | ✅ (same proven idea)                                          |
| Sonarr / Lidarr / Readarr                           | ✅                            | ✅                                                             |
| **Radarr**                                          | limited                       | ✅ fully supported                                             |
| Web interface                                       | —                             | ✅ complete (setup wizard, dashboard, settings)                |
| Configuration                                       | environment variables / files | ✅ entirely via the UI, persisted in SQLite                    |
| Title browser + manual title overrides              | —                             | ✅ fix individual mismatches instead of clearing the cache     |
| Language plugins                                    | German                        | ✅ German, Swedish, French (extensible)                        |
| Title providers                                     | PCJones API                   | ✅ PCJones API + TVDB + TMDB, configurable order               |
| Request/rename history                              | —                             | ✅ searchable, paginated, with retention policies              |
| Live logs                                           | container logs                | ✅ in the browser (WebSocket), filterable, exportable          |
| Statistics                                          | —                             | ✅ dashboard with cache rate, requests, renames                |
| Pause function                                      | —                             | ✅ time-based, no restart required                             |
| UI languages                                        | —                             | ✅ German, English, French, Swedish                            |
| Headless operation                                  | —                             | ✅ dedicated mode (~115 MiB RAM)                               |
| Memory behavior                                     | —                             | ✅ stable RAM usage in long-running operation, no memory leaks |
| Docker image security rebuilds                      | —                             | ✅ automatic every 2 days (OS/base-image patches)              |
| Development                                         | sporadic maintenance updates  | ✅ active development with a roadmap                           |

## What else EX brings

- **Operations & diagnostics:** guided first-run wizard (including Prowlarr import and
  automatic proxy installation into Prowlarr), connection tests, per-instance sync runs
  with error reporting, live progress.
- **Security:** session login (Argon2), CSRF protection, SSRF-hardened proxy, API keys
  kept server-side and automatically redacted from logs.
- **Data:** a single SQLite file — trivial to back up; migrations run automatically on
  startup.
- **Docker:** clear tag strategy (`:latest`, versioned tags, `:dev`), headless flag,
  bare-metal operation without a reverse proxy (systemd example included).

## Migrating

Indexer integration works on the same principle (HTTP proxy for Prowlarr, or the legacy
indexer API for direct integration). Coming from the original UmlautAdaptarr, you set up EX
via the setup wizard — existing Sonarr/Radarr/Prowlarr configurations can be kept as-is;
only the proxy endpoint changes.

## Thanks

UmlautAdaptarrEX stands on the shoulders of UmlautAdaptarr. Thanks to
[PCJones](https://github.com/PCJones) and all contributors to the original project — for
the idea, the community work, and the title API that EX uses to this day.
