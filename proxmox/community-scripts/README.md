# Proxmox VE Community-Script — UmlautAdaptarrEX

LXC deployment for [UmlautAdaptarrEX](https://github.com/xpsony/UmlautAdaptarrEX)
following the [community-scripts](https://community-scripts.org/docs/ct/readme)
(ProxmoxVED) format.

## Files

| File                                  | Purpose                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `ct/umlautadaptarrex.sh`              | CT wrapper: LXC defaults + in-place update logic                               |
| `install/umlautadaptarrex-install.sh` | Builds the app from the GitHub release tarball and registers a systemd service |
| `json/umlautadaptarrex.json`          | Website metadata (category 14 = \*Arr Suite)                                   |
| `misc/*.func`                         | Vendored community-scripts helpers (see "Self-hosted helpers" below)           |

## What it does

- Creates a Debian 13 LXC (2 vCPU, 2048 MB RAM for the build, 6 GB disk).
- Installs Node.js 26 + pnpm (version pinned in `package.json`, installed via npm), fetches the latest release of
  `xpsony/UmlautAdaptarrEX`, runs `pnpm build:prod` and `pnpm prisma:deploy`.
- Prompts for the three service ports during install (pre-filled with the
  defaults below; press Enter to accept):
  - **80** — web UI + setup wizard (`http://<IP>/setup`), the standard HTTP port
  - **5005** — public API + indexer routes for the \*arrs
  - **8080** — Prowlarr TCP proxy (standard HTTP-proxy port; basic auth, set during setup)
- Runs the app via systemd (`/usr/bin/node start.mjs`).
- The SQLite DB lives at `/opt/umlautadaptarrex/data/` and is preserved across
  updates.

## Usage

This script is **not** in the upstream community-scripts repo (yet). It is
self-hosted from this fork, so the one-liner below works directly from the
Proxmox VE host shell, no ProxmoxVED clone needed:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/xpsony/UmlautAdaptarrEX/main/proxmox/community-scripts/ct/umlautadaptarrex.sh)"
```

Once merged upstream, the standard community-scripts one-liner will be:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVED/main/ct/umlautadaptarrex.sh)"
```

### Self-hosted helpers

The community-scripts framework fetches its helper libraries **and** the
install script from a single base URL (`COMMUNITY_SCRIPTS_URL`). Because the
app-specific scripts live here and not in ProxmoxVED, the CT script sets that
base to this fork **after** sourcing `build.func`:

- `build.func` + `api.func` are still pulled from upstream
  `community-scripts/ProxmoxVED` at load time, so LXC creation and Proxmox
  version compatibility track the framework and are not frozen.
- Everything fetched afterwards (the install script plus `install.func`,
  `tools.func`, `core.func`, `error_handler.func`) is served from
  `proxmox/community-scripts/misc/` and `install/` in this repo.

The four files under `misc/` are verbatim copies of community-scripts
`ProxmoxVED@main`, vendored on 2026-06-02 (upstream commit `1f83bd4`), with two
URLs repointed to this fork:

- `core.func` — the `error_handler.func` fallback fetch now honors
  `COMMUNITY_SCRIPTS_URL`.
- `install.func` — the in-container `update` command re-runs this fork's CT
  script instead of the generic community-scripts OS updater.

> **Maintenance:** re-sync these four files when the framework changes (e.g. a
> new `setup_nodejs`/`fetch_and_deploy_gh_release` in `tools.func`), then
> re-apply the two URL patches above. `build.func` needs no sync since it stays
> upstream. The capture/debug install path in upstream `build.func`
> (`misc/build.func` line ~5174) hardcodes the community-scripts install URL and
> is the one flow that would not resolve against this fork; the normal install
> path is unaffected.

## Configuration

App configuration is done through the web setup wizard at
`http://<IP>:<web-port>/setup` on first access. The only values written to
`/opt/umlautadaptarrex/.env` are `NODE_ENV`, `DATABASE_URL`, and the three port
overrides chosen during install.

### Changing ports later

Edit `/opt/umlautadaptarrex/.env` and restart the service:

```bash
nano /opt/umlautadaptarrex/.env   # adjust UMLAUTADAPTARREX_WEBUI_PORT / _LEGACYAPI_PORT / _PROXY_PORT
systemctl restart umlautadaptarrex
```

Ports must be between 1 and 65535; an invalid value makes the service fail
fast at boot. Privileged ports below 1024 (such as the default Web UI port 80)
work because the LXC service runs as root. Because `UMLAUTADAPTARREX_PROXY_PORT` is set, the proxy-port field
in **Settings → Advanced** is read-only — change the proxy port here instead. An
LXC has its own IP, so there is no host-side port mapping: these values are the
ports the app binds inside the container.
