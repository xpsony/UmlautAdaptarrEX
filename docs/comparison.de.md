# UmlautAdaptarr vs. UmlautAdaptarrEX

> 🇬🇧 English version: [comparison.en.md](comparison.en.md)

**UmlautAdaptarr** (von [PCJones](https://github.com/PCJones/UmlautAdaptarr)) hat das Problem
gelöst, an dem deutschsprachige Sonarr-/Radarr-Setups jahrelang gescheitert sind: Releases mit
Umlauten und deutschen Titeln werden von den *Arrs nicht zuverlässig gefunden und zugeordnet.
Das Konzept — ein Proxy, der Suchanfragen um Titelvarianten erweitert und Release-Titel für
das Matching umschreibt — stammt aus diesem Projekt, und ohne diese Vorarbeit gäbe es
UmlautAdaptarrEX nicht. Auch die Titel-API von PCJones nutzt EX weiterhin als einen seiner
Titel-Provider.

**UmlautAdaptarrEX** ist eine von Grund auf neue Implementierung dieser Idee
(TypeScript, Next.js + Fastify + SQLite statt .NET) mit dem Ziel, das Konzept als aktiv
gepflegtes Produkt mit Web-Oberfläche, Diagnose-Werkzeugen und moderner Betriebsumgebung
weiterzuentwickeln.

## Auf einen Blick

|                                                 | UmlautAdaptarr               | UmlautAdaptarrEX                                                                        |
| ----------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| Grundprinzip (Proxy + Titelvarianten + Rewrite) | ✅                           | ✅ (gleiche bewährte Idee)                                                              |
| Sonarr / Lidarr / Readarr                       | ✅                           | ✅                                                                                      |
| **Radarr**                                      | eingeschränkt                | ✅ vollwertig unterstützt                                                               |
| Web-Oberfläche                                  | —                            | ✅ komplett (Setup-Wizard, Dashboard, Einstellungen)                                    |
| Konfiguration                                   | Umgebungsvariablen / Dateien | ✅ vollständig über die UI, in SQLite persistiert                                       |
| Titel-Browser + manuelles Titel-Override        | —                            | ✅ Fehlmatches pro Titel fixen statt Cache leeren                                       |
| Sprach-Plugins                                  | Deutsch                      | ✅ Deutsch, Schwedisch, Französisch (erweiterbar)                                       |
| Titel-Provider                                  | PCJones-API                  | ✅ PCJones-API + TVDB + TMDB, Reihenfolge konfigurierbar                                |
| Request-/Rename-Historie                        | —                            | ✅ durchsuchbar, sortierbar, paginiert, CSV-Export (Excel-sicher), Aufbewahrungsfristen |
| Tabellen & Deep-Links                           | —                            | ✅ sortierbare Spalten, Filter/Seite per URL teilbar, Zeilen-Detailansichten            |
| Instanz-Aktionen                                | —                            | ✅ Verbindungstest & Einzel-Sync direkt aus der Instanzliste                            |
| Live-Logs                                       | Container-Logs               | ✅ im Browser (WebSocket), filterbar, exportierbar, Auto-Reconnect                      |
| Statistiken                                     | —                            | ✅ Dashboard mit Cache-Rate, Requests, Renames                                          |
| Pause-Funktion                                  | —                            | ✅ zeitgesteuert, ohne Neustart                                                         |
| UI-Sprachen                                     | —                            | ✅ Deutsch, Englisch, Französisch, Schwedisch                                           |
| Barrierefreiheit                                | —                            | ✅ Tastaturbedienung, Screenreader-Labels, Skip-Link                                    |
| Headless-Betrieb                                | ✅ (immer, keine UI)         | ✅ wahlweise — Web-UI standardmäßig an, Headless-Modus opt-in (~115 MiB RAM)            |
| Speicherverhalten                               | —                            | ✅ stabiler RAM-Verbrauch auch im Langzeitbetrieb, keine Memory-Leaks                   |
| Sicherheits-Rebuilds des Docker-Images          | —                            | ✅ automatisch alle 2 Tage (OS-/Base-Image-Patches)                                     |
| Entwicklung                                     | sporadische Wartungs-Updates | ✅ aktive Weiterentwicklung mit Roadmap                                                 |

## Was EX darüber hinaus mitbringt

- **Betrieb & Diagnose:** Erst-Einrichtung als geführter Wizard (inkl. Prowlarr-Import und
  automatischer Proxy-Installation in Prowlarr), Verbindungstests, Sync-Läufe mit
  Fehleranzeige pro Instanz, Live-Fortschritt.
- **Sicherheit:** Session-Login (Argon2), CSRF-Schutz, SSRF-Härtung des Proxys,
  API-Schlüssel werden serverseitig gehalten und in Logs automatisch geschwärzt.
- **Datenhaltung:** Eine einzige SQLite-Datei — trivial zu sichern; Migrationen laufen
  beim Start automatisch.
- **Docker:** klare Tag-Strategie (`:latest`, versionierte Tags, `:dev`), Headless-Flag,
  Bare-Metal-Betrieb ohne Reverse-Proxy möglich (systemd-Beispiel liegt bei).

## Umstieg

Die Indexer-Anbindung funktioniert nach demselben Prinzip (HTTP-Proxy für Prowlarr bzw.
Legacy-Indexer-API für direkte Anbindung). Wer vom alten UmlautAdaptarr kommt, richtet EX
über den Setup-Wizard neu ein — bestehende Sonarr-/Radarr-/Prowlarr-Konfigurationen können
weiterverwendet werden, nur der Proxy-Endpunkt wechselt.

## Dank

UmlautAdaptarrEX steht auf den Schultern von UmlautAdaptarr. Danke an
[PCJones](https://github.com/PCJones) und alle Mitwirkenden des Originalprojekts — für die
Idee, die Community-Arbeit und die Titel-API, die EX bis heute nutzt.
