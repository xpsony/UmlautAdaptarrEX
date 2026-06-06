# syntax=docker/dockerfile:1.7

# ── Minimal runtime base ─────────────────────────────────────────────────────
FROM node:26-bookworm-slim AS base-runtime
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends openssl gosu wget ca-certificates

# ── Builder base ─────────────────────────────────────────────────────────────
FROM base-runtime AS base-builder
RUN npm install -g pnpm@11.3.0 \
  && pnpm config set store-dir /pnpm/store

# ── Full install (incl. devDeps for next build / tsup / prisma generate) ─────
FROM base-builder AS deps
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++
# `postinstall` runs `prisma generate`, which needs the schema + config — copy
# them in alongside the manifests so the install step doesn't fail.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
# ── Builder ──────────────────────────────────────────────────────────────────
FROM deps AS builder
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
COPY . .
RUN pnpm build

# ── Runtime-only deps: minimal install of just what runs in production ───────
FROM base-builder AS runtime-deps
WORKDIR /runtime
COPY package.json ./root-package.json
COPY docker/runtime-deps.names.json ./names.json
COPY docker/runtime-deps.pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN node -e "const root=require('./root-package.json');const {packages}=require('./names.json');const all={...root.dependencies,...root.devDependencies};const deps={};for(const n of packages){if(!all[n])throw new Error('runtime-deps: \"'+n+'\" is not a dependency in the root package.json');deps[n]=all[n];}require('fs').writeFileSync('package.json',JSON.stringify({name:'umlautadaptarrex-runtime',private:true,dependencies:deps},null,2));" \
  && rm root-package.json names.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod \
  && pnpm exec prisma generate

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM base-runtime AS runtime
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/umlautadaptarrex.db
# Legacy port vars kept as fallbacks; the branded names are the documented,
# user-facing knobs (override at runtime via compose / `docker run -e`).
ENV PORT=5005
ENV WEB_PORT=5007
ENV UMLAUTADAPTARREX_LEGACYAPI_PORT=5005
ENV UMLAUTADAPTARREX_WEBUI_PORT=5007
ENV UMLAUTADAPTARREX_PROXY_PORT=5006


# Next.js standalone bundle FIRST (Next traces its own subset of node_modules:
# next, react, ...). This seeds /app/node_modules with the UI runtime, including
# an INCOMPLETE @prisma/client stub (no generated client, no query engine).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Server runtime deps SECOND, overlaid on top: better-sqlite3, argon2, the
# prisma CLI and the COMPLETE @prisma/client (generated client + query engine).
# Both trees use pnpm's symlink layout, so this merges symlink-over-symlink and
# our complete @prisma/client wins over the standalone stub, while next/react
# (absent from this minimal set) remain from the standalone bundle.
COPY --from=runtime-deps --chown=node:node /runtime/node_modules ./node_modules
# public/ is NOT included in the standalone bundle — must be copied separately
# so static assets (logos, *Arr icons under /arr, /brand) are served by Next.
COPY --from=builder --chown=node:node /app/public ./public

# Server bundle (Fastify) + supervisor + prisma schema/migrations
COPY --from=builder --chown=node:node /app/dist/server ./dist/server
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/start.mjs ./start.mjs
COPY --from=builder --chown=node:node /app/package.json ./package.json


RUN mkdir -p /data && chown -R node:node /data /app

COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 5005 5006 5007
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${UMLAUTADAPTARREX_LEGACYAPI_PORT:-${PORT:-5005}}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "node", "start.mjs"]
