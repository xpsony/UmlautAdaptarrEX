<p align="center">
  <img src="public/brand/logo-mark.svg" alt="UmlautAdaptarrEX" height="160" />
</p>

<p align="center">
  <img src="public/brand/logo-wordmark.svg" alt="UmlautAdaptarrEX" height="40" />
</p>

<p align="center">
  <em>Umlaut and German-title proxy for Sonarr / Radarr / Lidarr / Readarr.</em>
</p>

<p align="center">
  <img src="public/arr/sonarr.svg" alt="Sonarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/radarr.svg" alt="Radarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/lidarr.svg" alt="Lidarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/readarr.svg" alt="Readarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/prowlarr.svg" alt="Prowlarr" height="36" />
</p>

<p align="center">
  <a href="README.md">Deutsch</a> · <strong>English</strong>
</p>

# UmlautAdaptarrEX

> **This is still an early beta version**
>
> In principle everything should more or less work.
>
> **Information about Radarr:**
>
> - TMDB / TVDB key is required for Radarr to work
> - TMDB / TVDB key is required for plugins to work
>
> **What has not been tested yet:**
>
> - Legacy mode
> - The plugins
> - Readarr
> - Lidarr
> - French / Swedish language
>
> If a release is not named correctly or bugs occur, please send me a PM first.
>
> ---
>
> **AI Disclaimer:** This project was built with the help of AI, but not "vibe coded". I have been a software developer for over 11 years and security is a high priority.

Full rewrite of the original .NET tool on **Next.js + Fastify + Prisma + SQLite**.

UmlautAdaptarrEX presents itself to the \*arrs as an indexer, sits between the \*arrs and the real indexers, and
corrects both searches and results so that releases with umlauts or German titles are reliably found, downloaded and
imported.

## Which problems does it solve?

- Releases with umlauts are often not found or imported correctly by the \*arrs (searching for `o` instead of `ö`,
  missing mapping at the indexer).
- Sonarr & Radarr expect the English title from TheTVDB / TMDB. For German productions or translations this leads to
  errors like `Found matching series/movie via grab history, but release was matched to series by ID`.
- Bad release naming (e.g. missing `GERMAN` tag) is optionally corrected so the \*arrs detect it properly.

## Features

| Feature                                                                                                                                 | Status |
| --------------------------------------------------------------------------------------------------------------------------------------- | :----: |
| <img src="public/arr/sonarr.svg" height="16" alt="" align="top" />&nbsp; Sonarr support                                                 |   ✓    |
| <img src="public/arr/radarr.svg" height="16" alt="" align="top" />&nbsp; Radarr support (native, via `alternateTitles` + optional TMDB) |   ✓    |
| <img src="public/arr/lidarr.svg" height="16" alt="" align="top" />&nbsp; Lidarr support                                                 |   ✓    |
| <img src="public/arr/readarr.svg" height="16" alt="" align="top" />&nbsp; Readarr support                                               |   ✓    |
| <img src="public/arr/prowlarr.svg" height="16" alt="" align="top" />&nbsp; Prowlarr & NZB Hydra support                                 |   ✓    |
| Newznab (Usenet) & Torznab (Torrent) support                                                                                            |   ✓    |
| Multiple instances per \*arr type (e.g. 2× Sonarr)                                                                                      |   ✓    |
| Detection of releases with German title & TVDB alias                                                                                    |   ✓    |
| Correct search and detection of titles with umlauts                                                                                     |   ✓    |
| Renaming of releases with bad naming (optional)                                                                                         |   ✓    |
| **Web UI** (setup wizard, login, dashboard, instances, sync runs, request & rename history)                                             |   ✓    |
| **Persistent SQLite database**, no cache loss after restart                                                                             |   ✓    |
| **Live logs** via WebSocket                                                                                                             |   ✓    |
| **Multiple title providers** with configurable order: pcjones-API, TVDB, TMDB                                                           |   ✓    |
| **Language plugins**: German umlauts (default), Swedish umlauts, French accents                                                         |   ✓    |
| **i18n**: German + English                                                                                                              |   ✓    |

## Language Plugins

Language plugins control how titles are normalized and which spelling variants are sent to the indexer. They can be
enabled individually during the setup wizard (step "Plugins") or later under **Settings → Plugins**. Several plugins
can run at the same time, e.g. when a library contains both German and French titles.

| Plugin              | Language | Default | Behavior                                                                                                                                 |
| ------------------- | :------: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **German umlauts**  |   `de`   |    ✓    | Latin variants (`ä → ae`, `ö → oe`, `ü → ue`, `ß → ss`) and no-dots variants (`ä → a`, …); strips articles `Der/Die/Das/The/An/A`.       |
| **Swedish umlauts** |   `sv`   |    ◯    | Swedish romanization: `Å → A` or `AA`, `Ä → A` or `AE`, `Ö → O` or `OE` (preserves case).                                                |
| **French accents**  |   `fr`   |    ◯    | Removes accents (`é → e`, `à → a`, `ç → c`, …) and expands ligatures (`æ → ae`, `œ → oe`); strips articles `Le/La/Les/Un/Une/Des/Du/De`. |

Each plugin generates multiple variation maps so that releases with mixed spellings (e.g. `Brueckenkopf` vs.
`Brückenkopf` vs. `Brueckenkopf`) are still reliably detected. Audio libraries (Lidarr) additionally use a
"strip-all" path that removes the diacritic letter entirely.

## Installation

Three ways to start the image. Whichever variant you pick: after the first start, open
`http://<host>:5007` and the setup wizard will walk you through account creation, mode, plugins, Prowlarr and proxy
configuration.

### Variant 1: Docker Compose (recommended)

The repository contains two compose files:

| File                         | Image source                                 | When to use?                                             |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `docker-compose.yml`         | Local build (`build: .`)                     | You cloned the repository and want to build from source. |
| `docker-compose.release.yml` | `lexfi/umlautadaptarrex:latest` (Docker Hub) | Fastest way, no repo checkout needed.                    |

Note: the image fixes permissions on the `/data` volume automatically at startup (default
`PUID=1000`, `PGID=1000`). A manual `chown` is no longer needed. If you want files under `./data` to be owned by a
different host user, set `PUID`/`PGID` as env variables (see comments in the respective compose file).

1. Start the container. Either with the image from Docker Hub:

   ```sh
   curl -O https://raw.githubusercontent.com/xpsony/UmlautAdaptarrEX/main/docker-compose.release.yml
   docker compose -f docker-compose.release.yml up -d
   ```

   or as a local build (requires a repo checkout):

   ```sh
   docker compose up -d
   ```

2. Open the web UI: [http://localhost:5007](http://localhost:5007).

Follow logs: `docker compose -f docker-compose.release.yml logs -f umlautadaptarrex` (or without `-f
docker-compose.release.yml` for the local build). Stop: `docker compose ... down`.
Update from Docker Hub: `docker compose -f docker-compose.release.yml pull && docker compose -f
docker-compose.release.yml up -d`. Update for local build: `docker compose build --pull && docker
compose up -d`.

### Variant 2: `docker run` (without Compose)

Sufficient if you do not want to clone the repository and just want to run the prebuilt image:

```sh
docker run -d \
  --name umlautadaptarrex \
  --restart unless-stopped \
  -p 5005:5005 \
  -p 5006:5006 \
  -p 5007:5007 \
  -v /srv/umlautadaptarrex/data:/data \
  -e TZ=Europe/Berlin \
  lexfi/umlautadaptarrex:latest
```

The directory `/srv/umlautadaptarrex/data` is created automatically on first start and the entrypoint will chown it
to `PUID:PGID` (default `1000:1000`). A manual `chown` is not needed.

Optional additional `-e` flags:

- `PUID=1000` / `PGID=1000` (UID and GID under which the app process runs. Files under `./data` will be owned by
  these IDs).
- `LOG_LEVEL=info` (Pino level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`).

Update: `docker pull lexfi/umlautadaptarrex:latest && docker rm -f umlautadaptarrex` and re-run the command above.
The `data/` volume is preserved.

### Variant 3: Unraid Template

The Unraid community template lives in a separate repository:
[xpsony/UmlautAdaptarrEX-Unraid-Template](https://github.com/xpsony/UmlautAdaptarrEX-Unraid-Template).
Submission to the Community Applications (CA) store is pending; once
listed, installation works directly from CA without entering a template URL.

Installation instructions, template URL, and field defaults (ports, PUID/PGID, appdata path) are
documented in the template repo's README.

### Variant 4: Bare metal / without Docker

Works on any Linux or macOS host with Node `>= 24` and `pnpm 11.3.0`. The supervisor in
[`start.mjs`](start.mjs) handles migration, Fastify (port 5005 + TCP proxy 5006) and Next.js (port
5007); no reverse proxy is required.

```sh
git clone https://github.com/xpsony/UmlautAdaptarrEX.git
cd UmlautAdaptarrEX
pnpm install --frozen-lockfile
pnpm prod      # build:prod -> prisma migrate deploy -> start:prod
```

The individual steps as separate scripts (e.g. for CI):

| Script               | What it does                                                                    |
| -------------------- | ------------------------------------------------------------------------------- |
| `pnpm build:prod`    | Builds Next.js (standalone) + Fastify bundle (tsup) with `NODE_ENV=production`. |
| `pnpm prisma:deploy` | Applies migrations idempotently to the SQLite DB.                               |
| `pnpm start:prod`    | Starts the supervisor (migrate -> Fastify -> Next.js child) with prod env.      |

Persistence: the `data/` directory (SQLite) stays in the repo working tree. For "survives a reboot",
a systemd unit ships under [`deploy/umlautadaptarrex.service`](deploy/umlautadaptarrex.service),
including examples for user, `WorkingDirectory` and hardening (`ProtectSystem`, `ReadWritePaths`).
Short version of the install:

```sh
sudo cp deploy/umlautadaptarrex.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now umlautadaptarrex
journalctl -u umlautadaptarrex -f
```

## Ports

| Port | Service        | Purpose                                                                         |
| ---- | -------------- | ------------------------------------------------------------------------------- |
| 5005 | Fastify        | Public API, legacy routes (`/<apiKey>/<host>/api`), WebSocket logs (`/ws/logs`) |
| 5006 | TCP HTTP proxy | Prowlarr indexer proxy with HTTPS CONNECT tunneling                             |
| 5007 | Next.js        | Web UI                                                                          |

The `data/` DB is mounted into the container and contains the entire configuration.

## Architecture

How UmlautAdaptarrEX sits between the \*arrs, Prowlarr and the indexers.

### Mode 1: Prowlarr indexer proxy (recommended, port 5006)

```
 ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
 │  Sonarr  │  │  Radarr  │  │  Lidarr  │  │ Readarr  │
 └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
      │             │             │             │
      │  Newznab/Torznab API (with *arr API key)│
      └─────────────┼─────────────┼─────────────┘
                    ▼
              ┌───────────┐
              │  Prowlarr │  Indexer manager
              └─────┬─────┘
                    │ HTTP (indexer scheme changed from https → http)
                    │ HTTP proxy: indexer proxies → "UmlautAdaptarrEX"
                    ▼
        ┌──────────────────────────────────┐
        │      UmlautAdaptarrEX            │
        │  ─────────────────────────────   │
        │  :5006  TCP proxy (Basic auth)   │◀── HTTP CONNECT tunnel for https targets
        │  :5005  Fastify API + legacy     │
        │  :5007  Web UI (Next.js)         │
        │                                  │
        │  Pipeline per request:           │
        │   1. Parse URL (t=search/...)    │
        │   2. Title lookup via providers  │
        │      (pcjones │ TVDB │ TMDB │    │
        │       db-cache, order            │
        │       configurable)              │
        │   3. Expand query with title     │
        │      variants (umlauts, aliases, │
        │      language plugin maps)       │
        │   4. Request to real indexer     │
        │   5. Rewrite XML response        │
        │      (title fix, rename, tags)   │
        │                                  │
        │  Persistence: SQLite (Prisma)    │
        │   • Settings, instances, apiKey  │
        │   • Title cache, sync runs       │
        │   • Request & rename history     │
        └──────────────┬───────────────────┘
                       │ HTTPS (outbound)
                       ▼
                ┌────────────┐
                │  Indexer   │  Newznab/Torznab,
                │  (Usenet/  │  NZB Hydra, ...
                │   Torrent) │
                └────────────┘
```

### Mode 2: Direct as indexer (without Prowlarr proxy, port 5005)

```
 ┌──────────┐    ┌──────────┐    ┌──────────┐
 │  Sonarr  │    │  Radarr  │    │  Lidarr  │  ...
 └────┬─────┘    └────┬─────┘    └────┬─────┘
      │               │               │
      │  Indexer URL entered as:      │
      │  http://<host>:5005/<apiKey>/<indexer-host>
      └───────────────┼───────────────┘
                      ▼
        ┌──────────────────────────────────┐
        │      UmlautAdaptarrEX            │
        │  Legacy route                    │
        │  /<apiKey>/<host>/api?t=...      │
        │  (same pipeline as above)        │
        └──────────────┬───────────────────┘
                       │ HTTPS
                       ▼
                ┌────────────┐
                │  Indexer   │
                └────────────┘
```

Key points:

- **5006** is the only port Prowlarr talks to directly (HTTP proxy with Basic auth, default user `UmlautAdaptarr`).
- **5005** carries both the admin API and the legacy route `/<apiKey>/<host>/api` for direct mode.
- **5007** is only the UI; it talks internally to 5005 (Next.js rewrites in `next.config.ts`).

## Configuration in Prowlarr (recommended)

Recommended method, because there is no speed loss with multiple indexers.

1. Start UmlautAdaptarrEX and walk through the setup in the web UI (create Sonarr/Radarr/Lidarr/Readarr instances).
2. In Prowlarr: **Settings → Indexers → Indexer Proxies → Add (HTTP)**
   - Name: `UmlautAdaptarrEX HTTP Proxy`
   - Host: container name (`umlautadaptarrex`) or host IP
   - Port: `5006`
   - Tag: `umlautadaptarrex`
   - Username/Password: use the credentials set in the setup wizard (step "Proxy"). The default user is
     `UmlautAdaptarr` and the password is auto-generated. Both values are visible at any time under **Settings →
     Proxy** in the web UI. If UmlautAdaptarrEX creates the Prowlarr indexer proxy configuration automatically
     (setup wizard, step "Prowlarr install"), the credentials are stored directly.
3. For all indexers that should use the proxy:
   - Add tag `umlautadaptarrex`
   - **Change the URL scheme from `https` to `http`**, only then can UmlautAdaptarrEX intercept the requests
     locally. Outgoing requests to the indexer remain `https`, of course.
4. Run **Test All Indexers**. If any `https` URLs remain, a warning appears in the live logs.

## Configuration without Prowlarr proxy

> Note: not yet tested

With only a few indexers or without Prowlarr, enter the API URL per indexer directly in
Sonarr/Radarr/Lidarr/Readarr:

```
http://<host>:5005/<apiKey>/<indexer-host>
```

The API key is set as usual. The `apiKey` for UmlautAdaptarrEX is created in the web UI.

The full HTTP API (admin, auth, legacy, WebSocket, TCP proxy) is documented in [docs/api.md](docs/api.md).
The release-rename pipeline is described in [docs/renaming.md](docs/renaming.md). For users who want to fork the
project and re-flag it under their own GitHub owner / Docker Hub namespace, the guide is in
[docs/forking.md](docs/forking.md), including `scripts/rebrand.sh` for the static defaults and the three runtime
levers (`DOCKERHUB_IMAGE`, `UMLAUTADAPTARREX_IMAGE`, `NEXT_PUBLIC_GITHUB_OWNER` / `NEXT_PUBLIC_GITHUB_REPO`).

## Local Development

```sh
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm dev
# Web UI:        http://localhost:5007
# Fastify API:   http://localhost:5005
# Prowlarr proxy: tcp://localhost:5006
```

### Development Container (VS Code)

For a reproducible dev environment, you can use the included devcontainer:

1. Open the repository in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. After the container has started: `pnpm dev`.

The container ships Node 24 (dev) resp. Node 26 (production image) + pnpm 11.3.0, forwards ports `5005/5006/5007` and sets recommended VS Code
extensions/settings for TypeScript, Next.js, Prisma, Tailwind, ESLint/Prettier, Vitest and Playwright.
After `pnpm dev` you reach the UI on port `5007` and the API on port `5005` (directly or via VS Code port
forwarding). The TCP proxy is reachable on port `5006`.

### Tests

```sh
pnpm test            # vitest (unit + integration)
pnpm test:e2e        # playwright (baseURL = http://localhost:5005)
pnpm typecheck
pnpm lint
```

## Project Structure

```
src/
├─ app/                   # Next.js App Router (web UI)
├─ components/            # React + shadcn UI
├─ server/                # Fastify gateway, TCP proxy, sync workers, logging
├─ domain/                # Framework-free core
│   ├─ normalization/     # Title normalization
│   ├─ variations/        # Title variants
│   ├─ matching/          # Release matching
│   ├─ plugins/           # Language plugins (DE umlauts, SE umlauts, FR accents)
│   └─ xml/               # Newznab/Torznab XML rewriting
├─ providers/             # External title providers (pcjones, TVDB, TMDB, db-cache)
├─ arr/                   # Sonarr/Radarr/Lidarr/Readarr/Prowlarr clients
├─ schemas/               # Zod schemas (shared client/server)
├─ messages/              # i18n (de.json, en.json)
└─ lib/                   # db, auth, secrets, legacy-env, i18n, utils
```

## Stack

- Node 24+ (production image: Node 26) / TypeScript / pnpm 11
- Next.js 16 / React 19 / Tailwind 4 / shadcn (new-york)
- Fastify 5 / Prisma 7 / SQLite (better-sqlite3)
- Zod 4 / next-intl / @tanstack/react-query
- Vitest 4 / Playwright

## Contact & Support

- GitHub issues for bug reports and feature requests
- [UsenetDE Discord](https://discord.gg/src6zcH4rr) → `#umlautadaptarr`

## Credits

Based on the idea and logic of [PCJones/UmlautAdaptarr](https://github.com/PCJones/UmlautAdaptarr).

## Disclaimer

UmlautAdaptarrEX is a technical compatibility proxy. The software does not download any content itself, does not
circumvent any technical protection measures (DRM) and does not establish connections to indexers that were not
previously configured in the \*arrs or in Prowlarr.

The project is intended exclusively for use with legal sources, such as your own backup copies, regularly subscribed
Usenet or tracker services, public-domain works, and content with explicit licensing by the rights holder.
Responsibility for lawful use of the \*arrs and the connected indexers lies entirely with the respective operator.

The authors assume no liability for any unintended or unlawful use. In Germany this includes the Copyright Act
(UrhG); comparable rules exist in other countries. The software is provided "as is", without any warranty (see MIT
license).

## License

MIT
