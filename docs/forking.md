# Forking and rebranding

This page explains how to retarget the GitHub owner, repository name and
Docker Hub image so the project builds, runs and documents itself under
your namespace instead of the upstream one. The three values are
independent — the Docker Hub namespace often differs from the GitHub
owner (e.g. `github:xpsony` vs `dockerhub:lexfi`), so each has its own
mechanism.

The upstream defaults baked into the source tree are:

| Variable     | Default                  |
| ------------ | ------------------------ |
| GitHub owner | `xpsony`                 |
| GitHub repo  | `UmlautAdaptarrEX`       |
| Docker image | `lexfi/umlautadaptarrex` |

## What can change at runtime vs build-time vs source

| Surface                                                               | Mechanism                                                                   | Files touched                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Docker Hub image pushed by CI                                         | GitHub repository variable `DOCKERHUB_IMAGE`                                | [.github/workflows/release.yml](../.github/workflows/release.yml#L24-L31)     |
| Docker image pulled by `docker compose -f docker-compose.release.yml` | Shell env var `UMLAUTADAPTARREX_IMAGE` (or `.env` next to the compose file) | [docker-compose.release.yml](../docker-compose.release.yml#L21)               |
| GitHub URL shown on the Web UI "About" page                           | Build-time env vars `NEXT_PUBLIC_GITHUB_OWNER` / `NEXT_PUBLIC_GITHUB_REPO`  | [src/app/(admin)/about/page.tsx](<../src/app/(admin)/about/page.tsx#L15-L22>) |
| README install instructions, in-tree defaults                         | `scripts/rebrand.sh` (one-shot find/replace)                                | [README.md](../README.md), the three files above (their fallback defaults)    |

The runtime mechanisms let you stand up CI, a Docker pull and the Web UI
under a new identity **without editing a single source file**. The
`rebrand.sh` script is for the static surface (README) and for baking
new defaults into the committed source so the runtime fallbacks also
match the fork.

The Unraid Community Application template lives in a separate
repository ([xpsony/UmlautAdaptarrEX-Unraid-Template](https://github.com/xpsony/UmlautAdaptarrEX-Unraid-Template))
and is not rebranded by `rebrand.sh`. Forks that want to publish an
Unraid template under their own namespace should fork the template repo
and adjust it there.

## `scripts/rebrand.sh`

Single command, three positional arguments, no env vars. Run it once
after forking; commit the diff.

```sh
./scripts/rebrand.sh <new-github-owner> <new-github-repo> <new-dockerhub-image>
```

Example:

```sh
./scripts/rebrand.sh johndoe MyFork johndoe/myfork
git diff
```

The script rewrites every hard-coded occurrence of the upstream defaults
in these files:

- `README.md`
- `docker-compose.release.yml` (fallback default of `UMLAUTADAPTARREX_IMAGE`)
- `.github/workflows/release.yml` (fallback default of `vars.DOCKERHUB_IMAGE`)
- `src/app/(admin)/about/page.tsx` (fallbacks of `NEXT_PUBLIC_GITHUB_OWNER` / `NEXT_PUBLIC_GITHUB_REPO`)

The substitution order inside the script (image first, then
`owner/repo`, then owner alone) avoids partial matches when the new
values happen to share substrings with the old ones. Files that do not
contain any of the three defaults are listed as `skip (missing)` but
that is just diagnostic output — nothing is skipped silently.

The script is **not** idempotent against running it twice with the same
arguments (the second run becomes a no-op because the old strings are
gone). To rebrand again, edit `OLD_OWNER` / `OLD_REPO` / `OLD_IMAGE` at
the top of the script, or revert and rerun.

## Runtime-only rebrand (no source edit)

If you do not want to commit a diff — e.g. you just want CI to push
under your namespace while keeping the upstream README in place — set
these instead of running the script:

1. **GitHub repository variable** (Settings → Secrets and variables →
   Actions → Variables):

   ```
   DOCKERHUB_IMAGE=johndoe/myfork
   ```

   Required secrets for the workflow stay the same: `DOCKERHUB_USERNAME`
   and `DOCKERHUB_TOKEN`. The workflow falls back to the in-source
   default only if the variable is unset.

2. **Docker Compose** (one of):

   ```sh
   UMLAUTADAPTARREX_IMAGE=johndoe/myfork:latest \
     docker compose -f docker-compose.release.yml up -d
   ```

   or pin it in a `.env` file next to `docker-compose.release.yml`:

   ```
   UMLAUTADAPTARREX_IMAGE=johndoe/myfork:latest
   ```

3. **Web UI "About" page** — set the build-time vars before
   `pnpm build` / `docker build`:

   ```
   NEXT_PUBLIC_GITHUB_OWNER=johndoe
   NEXT_PUBLIC_GITHUB_REPO=MyFork
   ```

   These are inlined at build time (Next.js public env contract), so a
   running container cannot retarget the About page without a rebuild.

## Things the script does **not** touch

- `package.json` `name` field (`umlautadaptarrex`) — this is the product
  name, not the fork identity.
- The product name `UmlautAdaptarrEX` as it appears throughout the UI,
  README headlines and code comments — rebranding the product is a
  separate exercise and intentionally not automated.
- `PCJones/UmlautAdaptarr` references — these are upstream credit links
  in the About page and the README that should stay regardless of the
  fork ([README.md](../README.md), [src/app/(admin)/about/page.tsx](<../src/app/(admin)/about/page.tsx>)).
- Docker Hub credentials, container names, network ports, volume paths.
- The Proxmox community scripts under `proxmox/community-scripts/` — the
  installer hard-codes `xpsony/UmlautAdaptarrEX` raw-GitHub URLs (the
  one-line `curl` command, the install script, and the JSON/README). A fork
  that wants its own LXC installer must edit those occurrences by hand;
  `rebrand.sh` does not sweep that directory.

## Docker Hub casing

Docker Hub image references are lowercase only. If your Docker Hub
display name uses capitals, pass the lowercased form to `rebrand.sh` and
to `DOCKERHUB_IMAGE` / `UMLAUTADAPTARREX_IMAGE`. The display
capitalisation can still be used in UI labels (e.g. the "Lexfi" author
chip on the About page is unaffected by the image rename).
