# History Pagination + Retention — Design

Date: 2026-08-06
Status: approved (user confirmed all recommended options; localization for all four languages: de, en, fr, sv)

## Problem

User report: searching/filtering "Request history" and "Rename history" only surfaces
the most recent entries ("last hour or so"). Two root causes:

1. The UI fetches a single page (default `take=50`) from
   `/api/admin/request-history` / `/api/admin/rename-history` and filters
   **client-side** within those 50 rows. Older rows are never loaded.
2. `RequestHistory` and `RenameHistory` have **no retention** at all — the tables
   grow unbounded (unlike `LogEntry`, which is purged by `LogRetentionScheduler`
   per `Setting.logRetentionDays`).

## Goals

- Full pagination on both history pages (server-side, using the existing
  `take`/`skip` API support).
- Server-side search across the whole retained period, not just the loaded page.
- A configurable retention setting for how long both histories are kept.

## Decisions (user-confirmed)

- **One shared setting** `historyRetentionDays` for both histories.
- **Default 30 days**, allowed range 1–365.
- **Prev/Next pagination** with "page X of Y", total count, page-size select
  (25/50/100/250).
- **Server-side search** sent as a query parameter; searches the full DB.
- **All four locales** (`de`, `en`, `fr`, `sv`) get the new strings.

## Design

### 1. Retention (backend)

- Prisma: `Setting.historyRetentionDays Int @default(30)` via a NEW migration
  (`pnpm prisma:migrate` — migrations are immutable).
- Zod (`src/schemas/settings.ts`):
  `historyRetentionDays: z.number().int().min(1).max(365).default(30)`.
- `src/server/state.ts`: add field + default (30) + row mapping.
- `src/server/routes/admin/settings.ts`: include in select + update paths.
- Purge: extend the existing `LogRetentionScheduler`
  (`src/server/logging/retention.ts`) so one tick also purges
  `requestHistory` and `renameHistory` rows older than `historyRetentionDays`.
  Same 6h interval, same 30s timeout race per delete, separate log lines
  (`history retention cleanup`). No second scheduler.

### 2. API

`src/server/routes/admin/history.ts`:

- `GET /api/admin/request-history`: add `search` query param —
  OR-contains over `query`, `externalId`, `domain`. Existing `type`/`domain`
  filters unchanged.
- `GET /api/admin/rename-history`: already supports `search`; unchanged.
- Response shape (`items`, `total`, `take`, `skip`) unchanged.

### 3. UI pagination

- New reusable `TablePagination` component (prev/next buttons, "page X of Y",
  total count, page-size select 25/50/100/250), rendered via a new optional
  `footerSlot` in `src/components/ui/history-page.tsx`.
- `request-history-client.tsx` / `rename-history-client.tsx`:
  - state: `page`, `pageSize`, `search`;
  - search input debounced ~300 ms, sent to the API;
  - react-query key includes `page`/`pageSize`/`search`,
    `placeholderData: keepPreviousData` to avoid flicker;
  - search change resets to page 1;
  - client-side filtering removed.

### 4. Settings UI + i18n

- "History retention (days)" number field in Settings → Advanced, same build
  as `logRetentionDays` (`advanced-tab.tsx`).
- New strings in **all** of `src/messages/{de,en,fr,sv}.json`:
  settings label + hint, pagination texts (page X of Y, previous, next,
  page size).

### 5. Tests

- Unit (vitest): retention purge logic (cutoff computation, deletes from all
  three tables, per-table counts), request-history `search` where-clause
  building.
- E2E (playwright): request-history API returns correctly sliced results for
  `take`/`skip`/`search`; fixtures use invented titles ("Galaxy Wars" style,
  never real media brands).

## Error handling

- Retention purge failures are logged and swallowed (scheduler keeps running),
  matching existing behavior.
- API clamps `take` (1–500) and `skip` (0–100000) via `clampInt`, unchanged.

## Out of scope

- Log page pagination (logs have their own retention + live stream).
- Separate retention values per history type.
- Sync-runs page pagination.
