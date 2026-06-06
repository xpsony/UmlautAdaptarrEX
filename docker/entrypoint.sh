#!/bin/sh
# Entrypoint shim: root is used ONLY to fix /data ownership and then drop to
# PUID:PGID via gosu — the application process (node start.mjs) never runs as
# root. When the container is already started unprivileged (docker --user,
# Kubernetes runAsUser, TrueNAS run_as), there is nothing to drop and no
# permission to chown, so exec directly and let the orchestrator own UID/GID and
# volume ownership.
set -e

# Strip whitespace (incl. CR from Windows-edited compose files) so a stray
# space in `- PUID=99 ` does not turn into `chown 99 :100`, which BusyBox
# chown cannot resolve.
PUID=$(printf '%s' "${PUID:-1000}" | tr -d '[:space:]')
PGID=$(printf '%s' "${PGID:-1000}" | tr -d '[:space:]')

# /data may be a read-only or pre-owned mount when running unprivileged, so do
# not let a failed mkdir abort the boot.
mkdir -p /data 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  chown -R "$PUID:$PGID" /data
  exec gosu "$PUID:$PGID" "$@"
fi

# Already non-root: PUID/PGID are advisory only; run as whoever we are.
exec "$@"
