<p align="center">
  <img src="public/brand/logo-mark.svg" alt="UmlautAdaptarrEX" height="160" />
</p>

<p align="center">
  <img src="public/brand/logo-wordmark.svg" alt="UmlautAdaptarrEX" height="40" />
</p>

<p align="center">
  <em>Umlaut- und Deutsch-Titel-Proxy für Sonarr / Radarr / Lidarr / Readarr.</em>
</p>

<p align="center">
  <img src="public/arr/sonarr.svg" alt="Sonarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/radarr.svg" alt="Radarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/lidarr.svg" alt="Lidarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/readarr.svg" alt="Readarr" height="36" />&nbsp;&nbsp;
  <img src="public/arr/prowlarr.svg" alt="Prowlarr" height="36" />
</p>

<p align="center">
  <strong>Deutsch</strong> · <a href="README.en.md">English</a>
</p>

# UmlautAdaptarrEX

> **Dies ist noch eine frühe Beta Version**
>
> Von Prinzip sollte alles mehr oder weniger funktionieren.
>
> **Information zu Radarr:**
>
> - TMDB / TVDB Key wird benötigt damit Radarr funktioniert
> - TMDB / TVDB Key wird benötigt damit Plugins funktionieren
>
> **Was wurde noch nicht getestet:**
>
> - Legacy Modus
> - Die Plugins
> - Readarr
> - Lidarr
> - Französische / Schwedische Sprache
>
> Sollte ein Release nicht korrekt benannt werden bzw. Bugs auftreten, bitte erstmal PM an mich.
>
> ---
>
> **AI Disclaimer:** Das Projekt wurde mit Hilfe von AI erstellt, jedoch nicht "gevibt coded". Ich bin seit über 11 Jahren Software Entwickler und Security hat einen hohen Stellenwert.

Vollständiger Rewrite des ursprünglichen .NET-Tools auf **Next.js + Fastify + Prisma + SQLite**.

UmlautAdaptarrEX gibt sich gegenüber den *arrs als Indexer aus, schaltet sich zwischen *arrs und den echten Indexer und
korrigiert Suchen wie Ergebnisse, damit Releases mit Umlauten oder deutschen Titeln zuverlässig gefunden, geladen und
importiert werden.

## Welche Probleme löst es?

- Releases mit Umlauten werden von den \*arrs sonst oft nicht korrekt gefunden oder importiert (Suche nach `o` statt
  `ö`, fehlende Zuordnung am Indexer).
- Sonarr & Radarr erwarten den englischen Titel von TheTVDB / TMDB. Bei deutschen Produktionen oder Übersetzungen
  führt das zu Fehlern wie `Found matching series/movie via grab history, but release was matched to series by ID`.
- Schlechtes Release-Naming (z. B. fehlendes `GERMAN`-Tag) wird optional korrigiert, sodass die \*arrs es korrekt
  erkennen.

## Features

| Feature                                                                                                                                | Status |
| -------------------------------------------------------------------------------------------------------------------------------------- | :----: |
| <img src="public/arr/sonarr.svg" height="16" alt="" align="top" />&nbsp; Sonarr Support                                                |   ✓    |
| <img src="public/arr/radarr.svg" height="16" alt="" align="top" />&nbsp; Radarr Support (nativ, via `alternateTitles` + optional TMDB) |   ✓    |
| <img src="public/arr/lidarr.svg" height="16" alt="" align="top" />&nbsp; Lidarr Support                                                |   ✓    |
| <img src="public/arr/readarr.svg" height="16" alt="" align="top" />&nbsp; Readarr Support                                              |   ✓    |
| <img src="public/arr/prowlarr.svg" height="16" alt="" align="top" />&nbsp; Prowlarr & NZB Hydra Support                                |   ✓    |
| Newznab (Usenet) & Torznab (Torrent) Support                                                                                           |   ✓    |
| Mehrere Instanzen je \*arr-Typ (z. B. 2× Sonarr)                                                                                       |   ✓    |
| Erkennung von Releases mit deutschem Titel & TVDB-Alias                                                                                |   ✓    |
| Korrekte Suche und Erkennung von Titeln mit Umlauten                                                                                   |   ✓    |
| Umbenennung von Releases mit schlechtem Naming (optional)                                                                              |   ✓    |
| **Web-UI** (Setup-Wizard, Login, Dashboard, Instanzen, Sync-Runs, Request- & Rename-History)                                           |   ✓    |
| **Persistente SQLite-Datenbank**, kein Cache-Verlust nach Neustart                                                                     |   ✓    |
| **Live-Logs** über WebSocket                                                                                                           |   ✓    |
| **Mehrere Title-Provider** mit konfigurierbarer Reihenfolge: pcjones-API, TVDB, TMDB                                                   |   ✓    |
| **Sprach-Plugins**: Deutsche Umlaute (default), Schwedische Umlaute, Französische Akzente                                              |   ✓    |
| **i18n**: Deutsch + Englisch                                                                                                           |   ✓    |

## Sprach-Plugins

Sprach-Plugins steuern, wie Titel normalisiert werden und welche Schreibvarianten gegen den Indexer gefahren werden.
Sie können im Setup-Wizard (Schritt "Plugins") oder
nachträglich unter **Settings → Plugins** einzeln aktiviert werden. Mehrere Plugins lassen sich gleichzeitig betreiben,
z. B. wenn eine Bibliothek deutsche und französische Titel enthält.

| Plugin                   | Sprache | Default | Verhalten                                                                                                                                  |
| ------------------------ | :-----: | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Deutsche Umlaute**     |  `de`   |    ✓    | Latin-Varianten (`ä → ae`, `ö → oe`, `ü → ue`, `ß → ss`) und ohne-Punkte-Varianten (`ä → a`, …); strippt Artikel `Der/Die/Das/The/An/A`.   |
| **Schwedische Umlaute**  |  `sv`   |    ◯    | Schwedische Romanisierung: `Å → A` oder `AA`, `Ä → A` oder `AE`, `Ö → O` oder `OE` (Groß-/Kleinschreibung bleibt erhalten).                |
| **Französische Akzente** |  `fr`   |    ◯    | Entfernt Akzente (`é → e`, `à → a`, `ç → c`, …) und löst Ligaturen auf (`æ → ae`, `œ → oe`); strippt Artikel `Le/La/Les/Un/Une/Des/Du/De`. |

Pro Plugin werden mehrere Variationsmaps generiert, sodass auch Releases mit gemischter Schreibweise (z. B. `Brueckenkopf`
vs. `Brückenkopf` vs. `Brueckenkopf`) zuverlässig erkannt werden. Audio-Bibliotheken (Lidarr) verwenden zusätzlich
einen "Strip-All"-Pfad, der den diakritischen Buchstaben komplett entfernt.

## Installation

Drei Wege, das Image zu starten. Egal welche Variante du wählst: nach dem ersten Start öffnest du
`http://<host>:5007` und der Setup-Wizard führt durch Account-Anlage, Modus, Plugins, Prowlarr- und
Proxy-Konfiguration.

### Variante 1: Docker Compose (empfohlen)

Es liegen zwei Compose-Dateien im Repository:

| Datei                        | Image-Quelle                                 | Wann nutzen?                                                       |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `docker-compose.yml`         | Lokaler Build (`build: .`)                   | Du hast das Repository geklont und willst aus dem Quellcode bauen. |
| `docker-compose.release.yml` | `lexfi/umlautadaptarrex:latest` (Docker Hub) | Schnellster Weg, kein Repo-Checkout nötig.                         |

Hinweis: das Image korrigiert die Rechte des `/data`-Volumes beim Start automatisch (Default
`PUID=1000`, `PGID=1000`). Ein manueller `chown` ist nicht mehr nötig. Wer Files unter `./data` mit
einem anderen Host-User besitzen möchte, setzt `PUID`/`PGID` als Env-Variablen (siehe Kommentare in
der jeweiligen Compose-Datei).

1. Container starten. Entweder mit Image vom Docker Hub:

   ```sh
   curl -O https://raw.githubusercontent.com/xpsony/UmlautAdaptarrEX/main/docker-compose.release.yml
   docker compose -f docker-compose.release.yml up -d
   ```

   oder als lokaler Build (Repo-Checkout vorausgesetzt):

   ```sh
   docker compose up -d
   ```

2. Web-UI öffnen: [http://localhost:5007](http://localhost:5007).

Logs verfolgen: `docker compose -f docker-compose.release.yml logs -f umlautadaptarrex` (bzw. ohne `-f
docker-compose.release.yml` beim lokalen Build). Stop: `docker compose ... down`.
Update vom Docker Hub: `docker compose -f docker-compose.release.yml pull && docker compose -f
docker-compose.release.yml up -d`. Update bei lokalem Build: `docker compose build --pull && docker
compose up -d`.

### Variante 2: `docker run` (ohne Compose)

Reicht, wenn du das Repository nicht klonen möchtest und nur das fertige Image laufen lassen willst:

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

Das Verzeichnis `/srv/umlautadaptarrex/data` wird beim ersten Start automatisch angelegt und vom
Entrypoint auf `PUID:PGID` (Default `1000:1000`) gesetzt. Ein manueller `chown` ist nicht nötig.

Optional als zusätzliche `-e`-Flags:

- `PUID=1000` / `PGID=1000` (UID und GID, mit denen der App-Prozess läuft. Files unter `./data`
  bekommen diese Owner-IDs).
- `LOG_LEVEL=info` (Pino-Level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`).

Update: `docker pull lexfi/umlautadaptarrex:latest && docker rm -f umlautadaptarrex` und Befehl oben
erneut ausführen. Das `data/`-Volume bleibt dabei erhalten.

### Variante 3: Unraid Template

Für Unraid gibt es ein Community-Template in einem separaten Repository:
[xpsony/UmlautAdaptarrEX-Unraid-Template](https://github.com/xpsony/UmlautAdaptarrEX-Unraid-Template).
Aufnahme in den Community-Applications-Store (CA) ist beantragt, danach ist die Installation
direkt aus CA möglich, ohne Template-URL.

Installationsanleitung, Template-URL und Feld-Defaults (Ports, PUID/PGID, Appdata-Pfad) stehen
im README des Template-Repos.

### Variante 4: Bare-Metal / ohne Docker

Funktioniert auf jedem Linux- oder macOS-Host mit Node `>= 24` und `pnpm 11.3.0`. Der Supervisor in
[`start.mjs`](start.mjs) übernimmt Migration, Fastify (Port 5005 + TCP-Proxy 5006) und Next.js (Port
5007), ein Reverse-Proxy ist nicht nötig.

```sh
git clone https://github.com/xpsony/UmlautAdaptarrEX.git
cd UmlautAdaptarrEX
pnpm install --frozen-lockfile
pnpm prod      # build:prod -> prisma migrate deploy -> start:prod
```

Die einzelnen Schritte als separate Scripts (z. B. für CI):

| Script               | Was passiert                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `pnpm build:prod`    | Baut Next.js (Standalone) + Fastify-Bundle (tsup) mit `NODE_ENV=production`. |
| `pnpm prisma:deploy` | Wendet Migrationen idempotent auf die SQLite-DB an.                          |
| `pnpm start:prod`    | Startet den Supervisor (Migration → Fastify → Next.js-Child) mit Prod-Env.   |

Persistenz: der `data/`-Ordner (SQLite) bleibt im Repo-Verzeichnis. Für „läuft nach Reboot" liegt
eine systemd-Unit unter [`deploy/umlautadaptarrex.service`](deploy/umlautadaptarrex.service) bei,
inklusive Beispielen für User, `WorkingDirectory` und Hardening (`ProtectSystem`, `ReadWritePaths`).
Kurzfassung der Installation:

```sh
sudo cp deploy/umlautadaptarrex.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now umlautadaptarrex
journalctl -u umlautadaptarrex -f
```

## Ports

| Port | Dienst         | Zweck                                                                           |
| ---- | -------------- | ------------------------------------------------------------------------------- |
| 5005 | Fastify        | Public API, Legacy-Routen (`/<apiKey>/<host>/api`), WebSocket-Logs (`/ws/logs`) |
| 5006 | TCP HTTP-Proxy | Prowlarr-Indexer-Proxy mit HTTPS-CONNECT-Tunneling                              |
| 5007 | Next.js        | Web-UI                                                                          |

Die `data/`-DB wird in den Container gemountet und enthält die gesamte Konfiguration.

## Architektur

Wie UmlautAdaptarrEX zwischen den \*arrs, Prowlarr und den Indexern sitzt.

### Modus 1: Prowlarr-Indexer-Proxy (empfohlen, Port 5006)

```
 ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
 │  Sonarr  │  │  Radarr  │  │  Lidarr  │  │ Readarr  │
 └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
      │             │             │             │
      │  Newznab/Torznab API (mit *arr-API-Key) │
      └─────────────┼─────────────┼─────────────┘
                    ▼
              ┌───────────┐
              │  Prowlarr │  Indexer-Manager
              └─────┬─────┘
                    │ HTTP (Schema im Indexer von https → http)
                    │ HTTP-Proxy: Indexer-Proxies → "UmlautAdaptarrEX"
                    ▼
        ┌──────────────────────────────────┐
        │      UmlautAdaptarrEX            │
        │  ─────────────────────────────   │
        │  :5006  TCP-Proxy (Basic-Auth)   │◀── HTTP-CONNECT-Tunnel für https-Targets
        │  :5005  Fastify-API + Legacy     │
        │  :5007  Web-UI (Next.js)         │
        │                                  │
        │  Pipeline pro Request:           │
        │   1. URL parsen (t=search/...)   │
        │   2. Title-Lookup über Provider  │
        │      (pcjones │ TVDB │ TMDB │    │
        │       db-cache, Reihenfolge      │
        │       konfigurierbar)            │
        │   3. Query um Titelvarianten     │
        │      erweitern (Umlaute, Aliase, │
        │      Sprach-Plugin-Maps)         │
        │   4. Request an echten Indexer   │
        │   5. XML-Response umschreiben    │
        │      (Title-Fix, Rename, Tags)   │
        │                                  │
        │  Persistenz: SQLite (Prisma)     │
        │   • Settings, Instanzen, ApiKey  │
        │   • Title-Cache, Sync-Runs       │
        │   • Request- & Rename-History    │
        └──────────────┬───────────────────┘
                       │ HTTPS (ausgehend)
                       ▼
                ┌────────────┐
                │  Indexer   │  Newznab/Torznab,
                │  (Usenet/  │  NZB Hydra, ...
                │   Torrent) │
                └────────────┘
```

### Modus 2: Direkt als Indexer (ohne Prowlarr-Proxy, Port 5005)

```
 ┌──────────┐    ┌──────────┐    ┌──────────┐
 │  Sonarr  │    │  Radarr  │    │  Lidarr  │  ...
 └────┬─────┘    └────┬─────┘    └────┬─────┘
      │               │               │
      │  Indexer-URL eingetragen als: │
      │  http://<host>:5005/<apiKey>/<indexer-host>
      └───────────────┼───────────────┘
                      ▼
        ┌──────────────────────────────────┐
        │      UmlautAdaptarrEX            │
        │  Legacy-Route                    │
        │  /<apiKey>/<host>/api?t=...      │
        │  (gleiche Pipeline wie oben)     │
        └──────────────┬───────────────────┘
                       │ HTTPS
                       ▼
                ┌────────────┐
                │  Indexer   │
                └────────────┘
```

Kernpunkte:

- **5006** ist der einzige Port, den Prowlarr direkt anspricht (HTTP-Proxy mit Basic-Auth, Default-User `UmlautAdaptarr`).
- **5005** trägt sowohl die Admin-API als auch die Legacy-Route `/<apiKey>/<host>/api` für den Direktmodus.
- **5007** ist nur die UI; sie redet intern mit 5005 (Next.js-Rewrites in `next.config.ts`).

## Konfiguration in Prowlarr (empfohlen)

Empfohlene Methode, da bei mehreren Indexern kein Geschwindigkeitsverlust entsteht.

1. UmlautAdaptarrEX starten und im Web-UI Setup durchlaufen (Sonarr/Radarr/Lidarr/Readarr-Instanzen anlegen).
2. In Prowlarr: **Settings → Indexers → Indexer Proxies → Add (HTTP)**
   - Name: `UmlautAdaptarrEX HTTP Proxy`
   - Host: Containername (`umlautadaptarrex`) oder Host-IP
   - Port: `5006`
   - Tag: `umlautadaptarrex`
   - Username/Passwort: die im Setup-Wizard (Schritt "Proxy") gesetzten Zugangsdaten eintragen.
     Default-User ist `UmlautAdaptarr`, das Passwort wird automatisch generiert. Beide Werte
     stehen jederzeit unter **Settings → Proxy** in der Web-UI. Wenn UmlautAdaptarrEX die
     Prowlarr-Indexer-Proxy-Konfiguration automatisch anlegt (Setup-Wizard, Schritt
     "Prowlarr-Install"), werden die Credentials direkt mit hinterlegt.
3. Bei allen Indexern, die den Proxy nutzen sollen:
   - Tag `umlautadaptarrex` hinzufügen
   - **URL-Schema von `https` auf `http` ändern**, nur so kann UmlautAdaptarrEX die Anfragen lokal abfangen.
     Ausgehende Anfragen an den Indexer bleiben natürlich `https`.
4. **Test All Indexers** ausführen. Bei verbliebenen `https`-URLs erscheint eine Warnung in den Live-Logs.

## Konfiguration ohne Prowlarr-Proxy

> Anmerkung : Aktuell noch nicht getestet

Bei wenigen Indexern oder ohne Prowlarr direkt in Sonarr/Radarr/Lidarr/Readarr je Indexer als API-URL eintragen:

```
http://<host>:5005/<apiKey>/<host-des-indexers>
```

API-Key wird normal gesetzt. Den `apiKey` für UmlautAdaptarrEX erzeugst du im Web-UI.

Die vollständige HTTP-API (Admin, Auth, Legacy, WebSocket, TCP-Proxy) ist in [docs/api.md](docs/api.md) dokumentiert.
Die Release-Rename-Pipeline ist in [docs/renaming.md](docs/renaming.md) beschrieben. Wer das Projekt forken und auf
eigenen GitHub-Owner / Docker-Hub-Namespace umflaggen will, findet die Anleitung in
[docs/forking.md](docs/forking.md) — inkl. `scripts/rebrand.sh` für die statischen Defaults und der drei Runtime-Hebel
(`DOCKERHUB_IMAGE`, `UMLAUTADAPTARREX_IMAGE`, `NEXT_PUBLIC_GITHUB_OWNER` / `NEXT_PUBLIC_GITHUB_REPO`).

## Local Development

```sh
pnpm install
cp .env.example .env
pnpm prisma:migrate
pnpm dev
# Web-UI:        http://localhost:5007
# Fastify API:   http://localhost:5005
# Prowlarr-Proxy: tcp://localhost:5006
```

### Development Container (VS Code)

Für eine reproduzierbare Dev-Umgebung kannst du den enthaltenen Devcontainer nutzen:

1. Repository in VS Code öffnen.
2. `Dev Containers: Reopen in Container` ausführen.
3. Nach dem Container-Start: `pnpm dev`.

Der Container enthält Node 24 (Dev) bzw. Node 26 (Produktions-Image) + pnpm 11.3.0, leitet die Ports `5005/5006/5007` weiter und setzt empfohlene VS Code
Extensions/Settings für TypeScript, Next.js, Prisma, Tailwind, ESLint/Prettier, Vitest und Playwright.
Nach `pnpm dev` erreichst du die UI über Port `5007` und die API über Port `5005` (direkt oder über VS Code Port
Forwarding). Der TCP-Proxy ist auf Port `5006` erreichbar.

### Tests

```sh
pnpm test            # vitest (unit + integration)
pnpm test:e2e        # playwright (baseURL = http://localhost:5005)
pnpm typecheck
pnpm lint
```

## Projektstruktur

```
src/
├─ app/                   # Next.js App Router (Web-UI)
├─ components/            # React + shadcn UI
├─ server/                # Fastify-Gateway, TCP-Proxy, Sync-Worker, Logging
├─ domain/                # Framework-freier Kern
│   ├─ normalization/     # Titelnormalisierung
│   ├─ variations/        # Titelvarianten
│   ├─ matching/          # Release-Matching
│   ├─ plugins/           # Sprach-Plugins (DE-Umlaute, SE-Umlaute, FR-Akzente)
│   └─ xml/               # Newznab/Torznab-XML-Rewriting
├─ providers/             # Externe Title-Provider (pcjones, TVDB, TMDB, db-cache)
├─ arr/                   # Sonarr/Radarr/Lidarr/Readarr/Prowlarr-Clients
├─ schemas/               # Zod-Schemas (shared client/server)
├─ messages/              # i18n (de.json, en.json)
└─ lib/                   # db, auth, secrets, legacy-env, i18n, utils
```

## Stack

- Node 24+ (Produktions-Image: Node 26) / TypeScript / pnpm 11
- Next.js 16 / React 19 / Tailwind 4 / shadcn (new-york)
- Fastify 5 / Prisma 7 / SQLite (better-sqlite3)
- Zod 4 / next-intl / @tanstack/react-query
- Vitest 4 / Playwright

## Kontakt & Support

- GitHub Issues für Bugreports und Feature-Requests
- [UsenetDE Discord](https://discord.gg/src6zcH4rr) → `#umlautadaptarr`

## Credits

Basiert auf der Idee und Logik von [PCJones/UmlautAdaptarr](https://github.com/PCJones/UmlautAdaptarr).

## Disclaimer

UmlautAdaptarrEX ist ein technischer Kompatibilitäts-Proxy. Die Software lädt selbst keine Inhalte herunter, umgeht
keine technischen Schutzmaßnahmen (DRM) und stellt keine Verbindung zu Indexern her, die nicht zuvor in den \*arrs oder
in Prowlarr konfiguriert wurden.

Das Projekt ist ausschließlich für die Nutzung mit legalen Quellen gedacht, etwa eigenen Sicherungskopien, regulär
abonnierten Usenet- oder Tracker-Diensten, gemeinfreien Werken sowie Inhalten mit ausdrücklicher Lizenz des
Rechteinhabers. Die Verantwortung für die rechtmäßige Nutzung der \*arrs und der angebundenen Indexer liegt
vollständig beim jeweiligen Betreiber.

Die Autoren übernehmen keine Haftung für eine zweckfremde oder rechtswidrige Verwendung. In Deutschland gilt
insbesondere das Urheberrechtsgesetz (UrhG), vergleichbare Regelungen bestehen in anderen Ländern. Die Software wird
"wie besehen" bereitgestellt, ohne jegliche Gewährleistung (siehe MIT-Lizenz).

## License

MIT
