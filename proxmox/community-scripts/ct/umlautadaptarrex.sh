#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVED/main/misc/build.func)
# Copyright (c) 2021-2026 community-scripts ORG
# Author: xpsony
# License: MIT | https://github.com/community-scripts/ProxmoxVED/raw/main/LICENSE
# Source: https://github.com/xpsony/UmlautAdaptarrEX

# Self-hosted source: until these scripts are merged into community-scripts, the
# install script and the helper libs it pulls (install/core/error_handler/tools)
# are served from this fork. Set AFTER sourcing build.func above, so build.func
# itself and api.func stay on the upstream community-scripts version (keeps LXC /
# Proxmox compatibility current); only the runtime fetches below honor this base.
# See proxmox/community-scripts/misc/ for the vendored helpers.
export COMMUNITY_SCRIPTS_URL="https://raw.githubusercontent.com/xpsony/UmlautAdaptarrEX/main/proxmox/community-scripts"

APP="UmlautAdaptarrEX"
var_tags="${var_tags:-arr;indexer;proxy}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-6}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-no}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/umlautadaptarrex ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  if check_for_gh_release "umlautadaptarrex" "xpsony/UmlautAdaptarrEX"; then
    msg_info "Stopping Service"
    systemctl stop umlautadaptarrex
    msg_ok "Stopped Service"

    msg_info "Backing up Data"
    cp /opt/umlautadaptarrex/.env /opt/umlautadaptarrex.env.bak
    cp -r /opt/umlautadaptarrex/data /opt/umlautadaptarrex.data.bak
    msg_ok "Backed up Data"

    CLEAN_INSTALL=1 fetch_and_deploy_gh_release "umlautadaptarrex" "xpsony/UmlautAdaptarrEX" "tarball"

    msg_info "Restoring Data"
    cp /opt/umlautadaptarrex.env.bak /opt/umlautadaptarrex/.env
    rm -rf /opt/umlautadaptarrex/data
    cp -r /opt/umlautadaptarrex.data.bak /opt/umlautadaptarrex/data
    rm -rf /opt/umlautadaptarrex.env.bak /opt/umlautadaptarrex.data.bak
    msg_ok "Restored Data"

    msg_info "Updating Application"
    cd /opt/umlautadaptarrex
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    $STD pnpm install --frozen-lockfile
    $STD pnpm build:prod
    $STD pnpm prisma:deploy
    msg_ok "Updated Application"

    msg_info "Starting Service"
    systemctl start umlautadaptarrex
    msg_ok "Started Service"
    msg_ok "Updated successfully!"
  fi
  exit
}

start
build_container
description

# Read the web UI port the user chose during install (falls back to the default).
WEBUI_PORT=$(pct exec "$CTID" -- sh -c "grep '^UMLAUTADAPTARREX_WEBUI_PORT=' /opt/umlautadaptarrex/.env | cut -d= -f2" 2>/dev/null)
[[ "$WEBUI_PORT" =~ ^[0-9]+$ ]] || WEBUI_PORT=5007

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:${WEBUI_PORT}/setup${CL}"
