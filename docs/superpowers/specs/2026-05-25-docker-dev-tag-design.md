# Docker Dev-Tag und CI-Optimierung: Design

**Status:** Approved
**Datum:** 2026-05-25
**Scope:** `.github/workflows/`, Doku-Update in `CLAUDE.md`

## Motivation

Aktuell werden Docker-Images nur beim GitHub Release gebaut. `:latest` bekommt jeder
Stable-Release (nicht-Prerelease), `:<version>` jedes Release. Es gibt keinen Kanal
fuer "letzter Stand vom Entwicklungs-Branch", ohne den Stable-Tag fuer alle bestehenden
Nutzer zu kontaminieren.

Ziel: ein dritter Image-Kanal `:dev`, der vom `dev`-Branch lebt, damit:

- bestehende Nutzer auf `:latest` weiter nur Stable bekommen,
- Tester gezielt `:dev` ziehen koennen,
- Versionen fuer Bug-Reports auf einen bestimmten Commit pinbar sind (`:dev-<sha>`).

Zusaetzlich wird CI auf relevante Branches eingeschraenkt. Aktuell startet jeder Push
auf jedem Branch CI, was bei Feature-Branches Doppelarbeit erzeugt (Branch-Push plus
PR-Trigger fuer denselben Stand).

## Tag-Strategie

| Tag                                          | Quelle                           | Multi-Arch    | Mutability               |
| -------------------------------------------- | -------------------------------- | ------------- | ------------------------ |
| `:latest`                                    | GitHub Release (kein Prerelease) | amd64 + arm64 | Bei jedem Stable-Release |
| `:<version>` (z.B. `:1.41.0`, `:v2.0.0-rc1`) | GitHub Release (alle)            | amd64 + arm64 | Immutable                |
| `:dev`                                       | Push auf `dev` Branch            | amd64 + arm64 | Bei jedem dev-Push       |
| `:dev-<short-sha>`                           | Push auf `dev` Branch            | amd64 + arm64 | Immutable                |
| `:buildcache-linux-{amd64,arm64}`            | Release-Workflow                 | per Arch      | Bei jedem Release        |
| `:dev-buildcache-linux-{amd64,arm64}`        | Dev-Workflow                     | per Arch      | Bei jedem dev-Push       |

**Prereleases bleiben verhaltensgleich:** nur Versions-Tag, kein `:latest`, kein `:dev`.
Wer eine RC testen will, pinned die Version explizit.

`short_sha` ist der erste 7-Stellen-Hex-Prefix von `${{ github.sha }}` (`${GITHUB_SHA:0:7}`).
Das `dev-<short-sha>` Tag erlaubt Bug-Reports der Form "ich nutze `:dev-a1b2c3d`".

## Komponenten

### 1. Neue Datei: `.github/workflows/dev-image.yml`

Spiegelt die Struktur von `release.yml` mit folgenden Unterschieden:

- **Trigger:**
  ```yaml
  on:
    push:
      branches: [dev]
  ```
- **Concurrency:** `group: dev-image-${{ github.ref }}`, `cancel-in-progress: true`.
  Im Gegensatz zu `release.yml`, wo `cancel-in-progress: false` ist: bei Releases
  willst du nichts abbrechen, bei dev-Pushes schon, ein neuer Commit soll den alten
  Build canceln.
- **`quality` Job:** ruft `./.github/workflows/verify.yml` (Reusable Workflow) auf.
  Build-Job hat `needs: quality`. Wenn typecheck/lint/test/build fehlschlagen, wird
  kein Image gebaut.
- **`build` Matrix:** identisch zu `release.yml` (amd64 nativ auf `ubuntu-latest`,
  arm64 nativ auf `ubuntu-24.04-arm`, push-by-digest).
- **`APP_VERSION` Build-Arg:** `dev-${short_sha}` (nicht `release.tag_name`).
- **OCI Labels:** `org.opencontainers.image.version=dev-${short_sha}`,
  `org.opencontainers.image.revision=${{ github.sha }}` (Rest identisch zu release).
- **Cache-Scopes:**
  ```
  cache-from / cache-to:
    type=gha,scope=dev-${pair}                                            # GHA cache, separat
    type=registry,ref=...:dev-buildcache-${pair},mode=max                # Registry-Cache, separat
  ```
  Kollidieren nicht mit den Release-Scopes `release-${pair}` /
  `:buildcache-${pair}`. Beide Kanaele cachen unabhaengig.
- **`merge` Job (Tag-Berechnung):**
  ```bash
  base="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}"
  short_sha="${GITHUB_SHA:0:7}"
  args=(-t "${base}:dev" -t "${base}:dev-${short_sha}")
  ```
  Keine Conditional Logic noetig. Beide Tags werden immer gesetzt.

### 2. `.github/workflows/ci.yml`: Trigger eingeschraenkt

Bisher:

```yaml
on:
  push:
  pull_request:
```

Neu:

```yaml
on:
  push:
    branches: [main, dev]
  pull_request:
```

Effekt: PRs werden weiter geprueft (das deckt Feature-Branches ab). Direct-Pushes auf
Feature-Branches ohne PR triggern keine CI mehr (CI-Minuten gespart). main- und
dev-Pushes laufen unveraendert.

### 3. `.github/workflows/release.yml`: unveraendert

Verhalten und Tag-Strategie bereits korrekt (`:latest` nur bei Stable, sonst nur
Versions-Tag).

### 4. `.github/workflows/verify.yml`: unveraendert

Reusable Workflow. Wird von ci.yml, release.yml und neu auch von dev-image.yml
genutzt.

### 5. `CLAUDE.md`: Tag-Strategie dokumentieren

Im Abschnitt "Docker" einen kurzen Absatz, der die drei Kanaele auflistet
(`:latest`, `:<version>`, `:dev`) und erklaert wann welcher Tag aktualisiert wird.

## Out of Scope

- **`docker-compose.dev-image.yml`**: keine eigene Compose-Datei. Tester koennen
  `UMLAUTADAPTARREX_IMAGE=lexfi/umlautadaptarrex:dev docker compose -f docker-compose.release.yml up -d`
  nutzen.
- **Cosign-Signaturen / SBOM**: bewusst nicht enthalten (Nutzer-Entscheidung).
- **Path-Filter** (Docs-only skippen): bewusst nicht enthalten, das Risiko falscher
  Filter ist groesser als der CI-Minuten-Gewinn.
- **Dev-Branch Branch-Protection in GitHub-Settings**: ausserhalb dieses Repos
  (GitHub-UI-Konfiguration). Empfehlung: "Require status checks: Typecheck, lint,
  test, build" auch fuer `dev`, damit kaputter dev nicht in `:dev` landet. Das ist
  aber eine Repo-Settings-Aenderung, kein Code.

## Operativer Workflow

```
Feature-Arbeit -> PR gegen dev -> CI prueft -> dev-Merge -> dev-image.yml
  baut :dev + :dev-<sha>. Tester ziehen :dev.

Stabilisierung -> dev -> main merge (PR) -> CI prueft.

Release -> Tag/Release auf main erstellen -> release.yml baut :latest +
  :<version>. Bestehende Nutzer (auf :latest) bekommen das neue Stable.
```

## Risiken / Edge Cases

- **Erster dev-Push**: `dev`-Branch existiert vermutlich noch nicht remote. Muss
  vor dem ersten dev-Build aus `main` erzeugt und gepushed werden.
- **Cache-Kollision** ausgeschlossen durch separate Scopes (`dev-*` vs.
  `release-*`).
- **Concurrency-Cancel auf dev**: laufender dev-Build wird beim naechsten Push
  abgebrochen. Das ist gewollt, nicht-fertige Builds wuerden ohnehin durch den
  Folgebuild ueberschrieben.
- **Tag-Overwrite-Permissions**: Docker Hub Access Token braucht weiter
  Read/Write/Delete (wie heute schon, da `:latest` auch ueberschrieben wird).
- **Verify-Workflow-Last**: verify.yml laeuft jetzt ggf. dreimal pro
  Stabilisierungs-Zyklus (PR gegen dev, dev-Push, PR gegen main). Akzeptabel,
  weil schnell (Build dauert unter 5 min) und entscheidend fuer Build-Schutz.

## Testing-Strategie

GitHub-Actions-Workflows lassen sich nicht lokal vollstaendig testen, deshalb:

1. **Syntax-Check**: `actionlint` ueber alle vier Workflow-Dateien laufen lassen
   (falls verfuegbar). Sonst manuelle YAML-Validierung.
2. **Trockenlauf vor Merge**: `dev`-Branch erstellen, einen kleinen Commit
   pushen, Workflow-Run live verfolgen. Beim ersten Lauf:
   - `verify` muss gruen sein.
   - Beide arch-Builds muessen pushen (Digest-Artifacts).
   - Merge-Job muss `:dev` und `:dev-<sha>` schreiben.
   - `docker pull lexfi/umlautadaptarrex:dev` und `docker run` auf amd64 und
     arm64.
3. **CI-Trigger-Aenderung**: einen PR gegen `main` oeffnen ohne den Branch zu
   pushen, CI muss laufen. Einen Branch-Push ohne PR, CI darf NICHT laufen
   (ausser auf `main` oder `dev`).

## Implementierungs-Reihenfolge

1. `ci.yml` Trigger einschraenken.
2. `dev-image.yml` neu anlegen.
3. `CLAUDE.md` Tag-Strategie ergaenzen.
4. Commit und Push auf einem Feature-Branch, PR gegen `main`.
5. Nach Merge: `dev`-Branch aus `main` erstellen und erstmalig pushen, Live-Run
   beobachten.
