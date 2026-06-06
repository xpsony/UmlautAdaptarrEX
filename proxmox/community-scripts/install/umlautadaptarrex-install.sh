#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: xpsony
# License: MIT | https://github.com/community-scripts/ProxmoxVED/raw/main/LICENSE
# Source: https://github.com/xpsony/UmlautAdaptarrEX

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y \
  build-essential \
  python3 \
  ca-certificates \
  openssl
msg_ok "Installed Dependencies"

NODE_VERSION="26" setup_nodejs

msg_info "Installing pnpm"
$STD npm install -g pnpm@11.3.0
msg_ok "Installed pnpm"

fetch_and_deploy_gh_release "umlautadaptarrex" "xpsony/UmlautAdaptarrEX" "tarball"

# Ask the user for the three service ports, pre-filled with the defaults. The app
# reads these as env vars at boot (see src/lib/ports.ts); only ports >=1024 are
# accepted. Setting the proxy port here pins it, making the Settings -> Advanced
# proxy-port field read-only in the web UI. Falls back to the default on cancel
# (e.g. a non-interactive run with no TTY).
prompt_port() {
  local label="$1" default="$2" __out="$3" val
  while true; do
    val=$(whiptail --backtitle "UmlautAdaptarrEX" --title "Port Configuration" \
      --inputbox "$label" 8 70 "$default" 3>&1 1>&2 2>&3) || val="$default"
    if [[ "$val" =~ ^[0-9]+$ ]] && ((val >= 1024 && val <= 65535)); then
      printf -v "$__out" '%s' "$val"
      return
    fi
    whiptail --title "Invalid Port" --msgbox "Port must be an integer between 1024 and 65535." 8 70
  done
}
prompt_port "Web UI port (browser + setup wizard):" 5007 WEBUI_PORT
prompt_port "API port (indexer endpoint the *arrs connect to):" 5005 LEGACYAPI_PORT
prompt_port "Prowlarr proxy port:" 5006 PROXY_PORT

msg_info "Configuring UmlautAdaptarrEX"
mkdir -p /opt/umlautadaptarrex/data
cat <<EOF >/opt/umlautadaptarrex/.env
NODE_ENV=production
DATABASE_URL=file:/opt/umlautadaptarrex/data/umlautadaptarrex.db
UMLAUTADAPTARREX_LEGACYAPI_PORT=${LEGACYAPI_PORT}
UMLAUTADAPTARREX_WEBUI_PORT=${WEBUI_PORT}
UMLAUTADAPTARREX_PROXY_PORT=${PROXY_PORT}
EOF
msg_ok "Configured UmlautAdaptarrEX (Web UI :${WEBUI_PORT}, API :${LEGACYAPI_PORT}, Proxy :${PROXY_PORT})"

msg_info "Building UmlautAdaptarrEX (this can take a while)"
cd /opt/umlautadaptarrex
$STD pnpm install --frozen-lockfile
$STD pnpm build:prod
$STD pnpm prisma:deploy
msg_ok "Built UmlautAdaptarrEX"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/umlautadaptarrex.service
[Unit]
Description=UmlautAdaptarrEX
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/umlautadaptarrex
EnvironmentFile=/opt/umlautadaptarrex/.env
ExecStart=/usr/bin/node start.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now umlautadaptarrex
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc
