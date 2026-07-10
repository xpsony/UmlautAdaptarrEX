# UmlautAdaptarrEX — Copilot instructions

- Read [CLAUDE.md](../CLAUDE.md) before changing the project. It captures the architecture, ports, and gotchas.
- The HTTP API surface is documented in [docs/api.md](../docs/api.md). Update it when you add or remove a route.
- Package manager is **pnpm** (11.11.0, pinned). Node `>=24` (CI, Docker image and devcontainer run Node 26). Never replace `pnpm-lock.yaml` with npm/yarn output.
- Validate non-trivial changes with `pnpm typecheck && pnpm lint && pnpm test`.
- Prisma owns the SQLite DB at `data/umlautadaptarrex.db`. Schema changes go through `pnpm prisma:migrate` only,
  never by hand-editing files under `prisma/migrations/` (a PreToolUse hook blocks this for agents).
- Legacy routes under [src/server/routes/legacy/](../src/server/routes/legacy/) must stay byte-compatible with the
  .NET predecessor in `old_code/UmlautAdaptarr/` (gitignored). Run the `legacy-compat-check` skill before touching them.
- Domain code under [src/domain/](../src/domain/) stays framework-free, no Fastify / React / Prisma imports. Test it
  via vitest in [tests/unit/](../tests/unit/).
- Secrets (`Setting.tmdbApiKey`, `Setting.prowlarrApiKey`, `Setting.proxyPassword`) are server-only. Never echo them
  back to the UI, expose only a `configured: boolean`.
- shadcn/ui is configured in [components.json](../components.json); add components via
  `pnpm dlx shadcn@latest add <component>`.
- Local dev uses `pnpm dev` (Fastify :5005 + Next.js :5007 via concurrently). Production runs through
  [start.mjs](../start.mjs).
