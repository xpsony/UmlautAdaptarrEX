# No Node-26 tag of javascript-node exists yet; Node 26 is layered on top via
# the ghcr.io/devcontainers/features/node feature in devcontainer.json.
FROM mcr.microsoft.com/devcontainers/javascript-node:5-26-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl sqlite3 \
  && rm -rf /var/lib/apt/lists/*
