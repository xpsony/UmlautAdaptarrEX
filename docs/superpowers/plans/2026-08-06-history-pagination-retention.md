# History Pagination + Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side pagination + full-period search on the request-history and rename-history pages, plus a shared `historyRetentionDays` setting (default 30) that purges both tables.

**Architecture:** The admin history API already supports `take`/`skip`; we add a `search` param to request-history, extend the existing retention scheduler (`src/server/logging/retention.ts`) to also purge `RequestHistory`/`RenameHistory`, and rewire both UI clients from "fetch 50 rows + client filter" to server-driven pagination with a shared `TablePagination` component. All strings land in all four locales (`de`, `en`, `fr`, `sv`).

**Tech Stack:** Fastify, Prisma/SQLite, Zod, Next.js App Router (client components), @tanstack/react-query v5, next-intl, vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-06-history-pagination-retention-design.md`

Repo gotchas that apply to every task:

- Migrations are immutable - schema changes ONLY via `pnpm prisma:migrate` (a PreToolUse hook blocks edits under `prisma/migrations/`).
- A PostToolUse hook runs prettier on every edited file - re-Read files before chained edits.
- Code comments in English; user-visible strings stay in the file's language.
- Test fixtures never use real media titles (use invented ones, "Galaxy Wars" style).

---

### Task 1: Prisma schema field + migration

**Files:**

- Modify: `prisma/schema.prisma` (Setting model, directly after the `logRetentionDays` field, around line 68)

- [ ] **Step 1: Add the field to the Setting model**

In `prisma/schema.prisma`, after the `logRetentionDays Int @default(3)` line inside `model Setting`, add:

```prisma
  // Wie lange Anfragen-/Umbenennungs-Verlauf aufbewahrt werden (Tage). Ein
  // gemeinsamer Wert für RequestHistory + RenameHistory; der Cleanup-Job
  // (alle 6h) löscht ältere Zeilen. Default 30.
  historyRetentionDays Int     @default(30)
```

(Comment language: the surrounding Setting model uses German comments - match them.)

- [ ] **Step 2: Create the migration**

Run: `pnpm prisma:migrate --name history-retention-days`
Expected: new folder `prisma/migrations/<timestamp>_history_retention_days/` containing `ALTER TABLE "Setting" ADD COLUMN "historyRetentionDays" INTEGER NOT NULL DEFAULT 30;` and `prisma generate` runs.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(db): add Setting.historyRetentionDays (default 30)"
```

---

### Task 2: Zod schema, state snapshot, settings route

**Files:**

- Create: `tests/unit/schemas-settings.test.ts`
- Modify: `src/schemas/settings.ts` (after `logRetentionDays`, line ~71)
- Modify: `src/server/state.ts` (AppSettings interface ~line 89, NO_SETTINGS ~line 109, toSettingsSnapshot ~line 267)
- Modify: `src/server/routes/admin/settings.ts` (getSettings select, ~line 56)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schemas-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SettingsSchema, SettingsUpdateSchema } from "@/schemas/settings";

describe("SettingsSchema.historyRetentionDays", () => {
  it("defaults to 30", () => {
    const parsed = SettingsSchema.parse({});
    expect(parsed.historyRetentionDays).toBe(30);
  });

  it("accepts the bounds 1 and 365", () => {
    expect(SettingsUpdateSchema.parse({ historyRetentionDays: 1 }).historyRetentionDays).toBe(1);
    expect(SettingsUpdateSchema.parse({ historyRetentionDays: 365 }).historyRetentionDays).toBe(
      365,
    );
  });

  it("rejects 0, negative, fractional and >365 values", () => {
    for (const bad of [0, -1, 1.5, 366]) {
      expect(SettingsUpdateSchema.safeParse({ historyRetentionDays: bad }).success).toBe(false);
    }
  });
});
```

Note: if `SettingsSchema.parse({})` fails because other fields lack defaults, check the schema first - every field in `SettingsSchema` has a `.default()` or is optional (verify by reading `src/schemas/settings.ts`). If some field has no default, build the minimal valid object instead; the assertion stays `parsed.historyRetentionDays === 30`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/schemas-settings.test.ts`
Expected: FAIL - `historyRetentionDays` is `undefined` (unknown keys are stripped).

- [ ] **Step 3: Add the field to the Zod schema**

In `src/schemas/settings.ts`, directly after the `logRetentionDays` line:

```ts
  // Shared retention for RequestHistory + RenameHistory rows (days). The
  // cleanup job purges older rows every 6 hours.
  historyRetentionDays: z.number().int().min(1).max(365).default(30),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/schemas-settings.test.ts`
Expected: PASS

- [ ] **Step 5: Thread the field through the server state snapshot**

In `src/server/state.ts` make three edits:

1. `interface AppSettings` - after `logRetentionDays: number;` add:

```ts
historyRetentionDays: number;
```

2. `const NO_SETTINGS: AppSettings` - after `logRetentionDays: 3,` add:

```ts
  historyRetentionDays: 30,
```

3. `toSettingsSnapshot()` - after `logRetentionDays: row.logRetentionDays,` add:

```ts
      historyRetentionDays: row.historyRetentionDays,
```

- [ ] **Step 6: Expose the field in the settings GET route**

In `src/server/routes/admin/settings.ts`, inside `getSettings()`'s `select: { ... }`, after `logRetentionDays: true,` add:

```ts
      historyRetentionDays: true,
```

(PUT needs no change - `SettingsUpdateSchema` now accepts the field and `prisma.setting.update` writes it; the update response returns the full row.)

- [ ] **Step 7: Run the settings test suites + typecheck**

Run: `pnpm vitest run tests/unit/schemas-settings.test.ts tests/unit/admin-settings-route.test.ts tests/unit/state-getters.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/schemas/settings.ts src/server/state.ts src/server/routes/admin/settings.ts tests/unit/schemas-settings.test.ts
git commit -m "feat(settings): add historyRetentionDays setting (1-365, default 30)"
```

---

### Task 3: Extend the retention scheduler to purge history tables

**Files:**

- Modify: `tests/unit/log-retention.test.ts`
- Modify: `src/server/logging/retention.ts`
- Modify: `src/server/index.ts` (only if you rename - we do NOT rename; class stays `LogRetentionScheduler`)

The scheduler keeps its name and wiring; one tick now purges three tables. Per-table deletes each race the existing 30s timeout. The whole purge stays inside one try/catch (matches current error semantics: any failure logs `error` and returns 0).

- [ ] **Step 1: Update mocks and add failing tests**

Replace the `vi.hoisted`/`vi.mock` block at the top of `tests/unit/log-retention.test.ts` (lines 3–18) with:

```ts
const { mockLog, mockReqHistory, mockRenameHistory, mockState } = vi.hoisted(() => ({
  mockLog: {
    deleteMany: vi.fn(),
  },
  mockReqHistory: {
    deleteMany: vi.fn(),
  },
  mockRenameHistory: {
    deleteMany: vi.fn(),
  },
  mockState: {
    settings: { logRetentionDays: 14, historyRetentionDays: 30 },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    logEntry: mockLog,
    requestHistory: mockReqHistory,
    renameHistory: mockRenameHistory,
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));
```

Replace the `beforeEach`/`afterEach` (lines 42–49) with:

```ts
beforeEach(() => {
  for (const m of [mockLog, mockReqHistory, mockRenameHistory]) {
    m.deleteMany.mockReset();
    m.deleteMany.mockResolvedValue({ count: 0 });
  }
  mockState.settings.logRetentionDays = 14;
  mockState.settings.historyRetentionDays = 30;
});

afterEach(() => {
  for (const m of [mockLog, mockReqHistory, mockRenameHistory]) {
    m.deleteMany.mockReset();
  }
});
```

In the existing test `"deletes log rows older than the retention window from settings"`, change the mock line `mockLog.deleteMany.mockResolvedValueOnce({ count: 3 });` to stay as-is (the beforeEach default covers the other two tables).

Then add these tests inside the `describe("LogRetentionScheduler", ...)` block:

```ts
it("purges request and rename history older than historyRetentionDays", async () => {
  mockState.settings.historyRetentionDays = 30;
  mockReqHistory.deleteMany.mockResolvedValueOnce({ count: 5 });
  mockRenameHistory.deleteMany.mockResolvedValueOnce({ count: 2 });

  const logger = makeLogger();
  const sched = new LogRetentionScheduler({ logger: logger as never });

  const before = Date.now();
  const deleted = await sched.runNow();
  const after = Date.now();

  expect(deleted).toBe(7); // 0 logs + 5 requests + 2 renames

  for (const mock of [mockReqHistory, mockRenameHistory]) {
    expect(mock.deleteMany).toHaveBeenCalledOnce();
    const cutoff = (
      mock.deleteMany.mock.calls[0]?.[0] as {
        where: { createdAt: { lt: Date } };
      }
    ).where.createdAt.lt;
    const expectedFloor = before - 30 * 24 * 60 * 60 * 1000;
    const expectedCeil = after - 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedFloor - 100);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedCeil + 100);
  }

  // One "history retention cleanup" info line for the two history tables.
  expect(logger.info).toHaveBeenCalledOnce();
  expect(logger.info.mock.calls[0]?.[1]).toBe("history retention cleanup");
});

it("uses independent cutoffs for logs and history", async () => {
  mockState.settings.logRetentionDays = 3;
  mockState.settings.historyRetentionDays = 60;
  const logger = makeLogger();
  const sched = new LogRetentionScheduler({ logger: logger as never });
  await sched.runNow();

  const logCutoff = (
    mockLog.deleteMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    }
  ).where.createdAt.lt.getTime();
  const histCutoff = (
    mockReqHistory.deleteMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    }
  ).where.createdAt.lt.getTime();
  // 60d cutoff lies further in the past than the 3d cutoff.
  expect(histCutoff).toBeLessThan(logCutoff);
});

it("does not log history cleanup when nothing was deleted", async () => {
  const logger = makeLogger();
  const sched = new LogRetentionScheduler({ logger: logger as never });
  await sched.runNow();
  expect(logger.info).not.toHaveBeenCalled();
});

it("logs an error and returns 0 when a history delete fails", async () => {
  mockReqHistory.deleteMany.mockRejectedValueOnce(new Error("io"));
  const logger = makeLogger();
  const sched = new LogRetentionScheduler({ logger: logger as never });
  expect(await sched.runNow()).toBe(0);
  expect(logger.error).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run tests/unit/log-retention.test.ts`
Expected: the 4 new tests FAIL (`requestHistory.deleteMany` never called); the pre-existing 4 still pass.

- [ ] **Step 3: Implement the extended purge**

Replace the `purge()` method in `src/server/logging/retention.ts` (and add the helper). Full new file body from the class downward:

```ts
// Retention days are read live from settings on each tick so UI changes apply
// without a restart. One tick purges three tables: LogEntry (logRetentionDays)
// plus RequestHistory and RenameHistory (shared historyRetentionDays).
export class LogRetentionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly opts: LogRetentionOptions) {}

  start(): void {
    this.timer = setTimeout(() => {
      void this.tick();
    }, FIRST_TICK_MS);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runNow(): Promise<number> {
    return this.purge();
  }

  private async tick(): Promise<void> {
    await this.purge();
    this.timer = setTimeout(() => {
      void this.tick();
    }, INTERVAL_MS);
  }

  // Race a delete against a hard timeout so a stuck DB lock can't
  // permanently disable cleanup.
  private withTimeout(p: Promise<{ count: number }>, label: string): Promise<{ count: number }> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} retention purge timed out after ${PURGE_TIMEOUT_MS}ms`)),
          PURGE_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
  }

  private async purge(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const settings = getAppState().settings;
      const dayMs = 24 * 60 * 60 * 1000;
      const logCutoff = new Date(Date.now() - settings.logRetentionDays * dayMs);
      const historyCutoff = new Date(Date.now() - settings.historyRetentionDays * dayMs);

      const logResult = await this.withTimeout(
        prisma.logEntry.deleteMany({ where: { createdAt: { lt: logCutoff } } }),
        "log",
      );
      if (logResult.count > 0) {
        this.opts.logger.info(
          { deleted: logResult.count, retentionDays: settings.logRetentionDays },
          "log retention cleanup",
        );
      }

      const requestResult = await this.withTimeout(
        prisma.requestHistory.deleteMany({ where: { createdAt: { lt: historyCutoff } } }),
        "request-history",
      );
      const renameResult = await this.withTimeout(
        prisma.renameHistory.deleteMany({ where: { createdAt: { lt: historyCutoff } } }),
        "rename-history",
      );
      if (requestResult.count + renameResult.count > 0) {
        this.opts.logger.info(
          {
            deletedRequests: requestResult.count,
            deletedRenames: renameResult.count,
            retentionDays: settings.historyRetentionDays,
          },
          "history retention cleanup",
        );
      }

      return logResult.count + requestResult.count + renameResult.count;
    } catch (err) {
      this.opts.logger.error({ err }, "log retention cleanup failed");
      return 0;
    } finally {
      this.running = false;
    }
  }
}
```

Keep the imports and constants at the top of the file unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/log-retention.test.ts && pnpm typecheck`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/logging/retention.ts tests/unit/log-retention.test.ts
git commit -m "feat(retention): purge request/rename history via historyRetentionDays"
```

---

### Task 4: `search` param on the request-history API

**Files:**

- Modify: `tests/unit/admin-history-route.test.ts`
- Modify: `tests/api/history-bridge.test.ts`
- Modify: `src/server/routes/admin/history.ts` (lines 32–39)

- [ ] **Step 1: Write the failing unit test**

In `tests/unit/admin-history-route.test.ts`, inside `describe("GET /api/admin/request-history", ...)`, add:

```ts
it("supports a free-text search over query, externalId and domain", async () => {
  mockReq.findMany.mockResolvedValueOnce([]);
  mockReq.count.mockResolvedValueOnce(0);
  await app.inject({
    method: "GET",
    url: "/api/admin/request-history?search=galaxy",
  });
  const args = mockReq.findMany.mock.calls[0]?.[0] as {
    where: { OR: unknown[] };
  };
  expect(args.where.OR).toEqual([
    { query: { contains: "galaxy" } },
    { externalId: { contains: "galaxy" } },
    { domain: { contains: "galaxy" } },
  ]);
});
```

- [ ] **Step 2: Write the failing API-level test**

In `tests/api/history-bridge.test.ts`, add a new describe block at the end of the file:

```ts
describe("admin /request-history search filter", () => {
  it("matches query, externalId or domain via contains across all pages", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.requestHistory.createMany({
      data: [
        {
          apiKey: "a",
          domain: INDEXER,
          type: "tvsearch",
          query: "Galaxy Wars S01",
          status: 200,
          durationMs: 5,
          cacheHit: false,
        },
        {
          apiKey: "a",
          domain: INDEXER,
          type: "tvsearch",
          query: "Hidden Valley",
          status: 200,
          durationMs: 5,
          cacheHit: false,
        },
        {
          apiKey: "a",
          domain: "other.example.test",
          type: "caps",
          query: null,
          externalId: "galaxy-123",
          status: 200,
          durationMs: 5,
          cacheHit: false,
        },
      ],
    });

    await seedAdminUser();
    const session = await login(app);

    const r = await app.inject({
      method: "GET",
      url: "/api/admin/request-history?search=galaxy",
      ...sessionCookieOnly(session),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { items: Array<{ query: string | null }>; total: number };
    // Matches "Galaxy Wars S01" (query, case-insensitive under SQLite for
    // ASCII) and "galaxy-123" (externalId), not "Hidden Valley".
    expect(body.total).toBe(2);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm vitest run tests/unit/admin-history-route.test.ts tests/api/history-bridge.test.ts`
Expected: the two new tests FAIL (where clause has no OR / total is 3).

- [ ] **Step 4: Implement the search param**

In `src/server/routes/admin/history.ts`, replace the request-history route's `buildWhere` callback:

```ts
app.get("/api/admin/request-history", { preHandler: requireAuth }, (req) =>
  paginatedList(req, prisma.requestHistory, (q) => {
    const where: Record<string, unknown> = {};
    if (q.type) where.type = q.type;
    if (q.domain) where.domain = q.domain;
    if (q.search) {
      where.OR = [
        { query: { contains: q.search } },
        { externalId: { contains: q.search } },
        { domain: { contains: q.search } },
      ];
    }
    return where;
  }),
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/admin-history-route.test.ts tests/api/history-bridge.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/admin/history.ts tests/unit/admin-history-route.test.ts tests/api/history-bridge.test.ts
git commit -m "feat(api): free-text search param on /api/admin/request-history"
```

---

### Task 5: i18n strings for all four locales

**Files:**

- Modify: `src/messages/de.json`, `src/messages/en.json`, `src/messages/fr.json`, `src/messages/sv.json`

There is a locale-parity test (`tests/unit/i18n-config.test.ts`) - all four files must receive the same keys or CI fails.

- [ ] **Step 1: Add the keys to every locale file**

Add a `pagination` object inside the existing `common` object, and two keys inside the existing `settings` object (place them right after `logRetentionDaysHint`).

`src/messages/de.json`:

```json
"common": {
  "pagination": {
    "previous": "Zurück",
    "next": "Weiter",
    "pageOf": "Seite {page} von {pageCount}",
    "perPage": "Pro Seite"
  }
}
```

```json
"settings": {
  "historyRetentionDays": "Verlauf-Aufbewahrung (Tage)",
  "historyRetentionDaysHint": "Anfragen- und Umbenennungs-Verlauf, die älter sind, werden alle 6 Stunden vom Cleanup-Job gelöscht. 1–365 Tage."
}
```

`src/messages/en.json`:

```json
"common": {
  "pagination": {
    "previous": "Previous",
    "next": "Next",
    "pageOf": "Page {page} of {pageCount}",
    "perPage": "Per page"
  }
}
```

```json
"settings": {
  "historyRetentionDays": "History retention (days)",
  "historyRetentionDaysHint": "Request and rename history entries older than this are removed by the cleanup job every 6 hours. 1–365 days."
}
```

`src/messages/fr.json`:

```json
"common": {
  "pagination": {
    "previous": "Précédent",
    "next": "Suivant",
    "pageOf": "Page {page} sur {pageCount}",
    "perPage": "Par page"
  }
}
```

```json
"settings": {
  "historyRetentionDays": "Rétention de l'historique (jours)",
  "historyRetentionDaysHint": "Les entrées de l'historique des requêtes et des renommages plus anciennes sont supprimées par le nettoyage toutes les 6 heures. 1 à 365 jours."
}
```

`src/messages/sv.json`:

```json
"common": {
  "pagination": {
    "previous": "Föregående",
    "next": "Nästa",
    "pageOf": "Sida {page} av {pageCount}",
    "perPage": "Per sida"
  }
}
```

```json
"settings": {
  "historyRetentionDays": "Historiklagring (dagar)",
  "historyRetentionDaysHint": "Poster i förfrågnings- och omdöpningshistoriken som är äldre än detta raderas av rensningsjobbet var 6:e timme. 1–365 dagar."
}
```

(These JSON snippets show the keys to MERGE into the existing objects - do not replace the whole `common`/`settings` objects.)

- [ ] **Step 2: Run the i18n parity test**

Run: `pnpm vitest run tests/unit/i18n-config.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/messages/
git commit -m "feat(i18n): pagination + history retention strings (de, en, fr, sv)"
```

---

### Task 6: `TablePagination` component + `footerSlot` in HistoryPage

**Files:**

- Create: `src/components/ui/table-pagination.tsx`
- Modify: `src/components/ui/history-page.tsx`

UI components are Playwright-tested, not vitest-covered (coverage excludes `src/app/**` and `src/components/**` deliberately) - verification here is typecheck + lint; behavior is exercised in Tasks 7/8.

- [ ] **Step 1: Create the component**

Create `src/components/ui/table-pagination.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PAGE_SIZES = [25, 50, 100, 250] as const;

interface TablePaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  /** Total row count across all pages. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/** Footer pagination bar for admin list pages: prev/next + page size select. */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const t = useTranslations("common.pagination");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("perPage")}</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-20" aria-label={t("perPage")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("pageOf", { page, pageCount })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          {t("previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          {t("next")}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

Before finalizing, check `src/components/ui/button.tsx` for the exact `variant`/`size` prop values (`"outline"` / `"sm"` are the shadcn defaults - confirm they exist).

- [ ] **Step 2: Add the footer slot to HistoryPage**

In `src/components/ui/history-page.tsx`:

1. Extend the props interface:

```ts
interface HistoryPageProps {
  title: string;
  subtitle: string;
  listTitle: string;
  listSubtitle: string;
  emptyTitle: string;
  emptyHint: string;
  emptyIcon: ReactNode;
  isLoading: boolean;
  isEmpty: boolean;
  filterSlot: ReactNode;
  columns: string[];
  rows: ReactNode;
  /** Optional footer (e.g. pagination bar) rendered below the table. */
  footerSlot?: ReactNode;
}
```

2. In the non-loading, non-empty branch, render the footer after the table:

```tsx
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {props.columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>{props.rows}</TableBody>
              </Table>
              {props.footerSlot}
            </>
          )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/table-pagination.tsx src/components/ui/history-page.tsx
git commit -m "feat(ui): TablePagination component + HistoryPage footer slot"
```

---

### Task 7: Debounce hook + request-history client rewiring

**Files:**

- Create: `src/app/_lib/use-debounced-value.ts`
- Modify: `src/app/(admin)/request-history/request-history-client.tsx`

- [ ] **Step 1: Create the debounce hook**

Create `src/app/_lib/use-debounced-value.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/** Returns `value` delayed by `delayMs`; resets the timer on every change. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

- [ ] **Step 2: Rewire the request-history client**

Replace the body of `src/app/(admin)/request-history/request-history-client.tsx` - imports, state, query and the `HistoryPage` call change; the row rendering (`statusVariant`, table cells) stays identical:

```tsx
"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { useDebouncedValue } from "@/app/_lib/use-debounced-value";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";

interface Row {
  id: string;
  type: string;
  domain: string;
  query: string | null;
  externalId: string | null;
  status: number;
  durationMs: number;
  cacheHit: boolean;
  createdAt: string;
}

function statusVariant(status: number): "success" | "warning" | "destructive" | "muted" {
  if (status >= 500) return "destructive";
  if (status >= 400) return "warning";
  if (status >= 200 && status < 300) return "success";
  return "muted";
}

export function RequestHistoryClient() {
  const t = useTranslations("history.request");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());

  const data = useQuery<{ items: Row[]; total: number }>({
    queryKey: ["request-history", page, pageSize, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch(`/api/admin/request-history?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  return (
    <HistoryPage
      title={t("title")}
      subtitle={t("subtitle")}
      listTitle={t("listTitle", { count: total })}
      listSubtitle={t("listSubtitle")}
      emptyTitle={t("emptyTitle")}
      emptyHint={t("emptyHint")}
      emptyIcon={<History className="h-5 w-5" />}
      isLoading={data.isLoading}
      isEmpty={items.length === 0}
      filterSlot={
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("filterPlaceholder")}
            className="pl-9"
          />
        </div>
      }
      columns={[
        t("createdAt"),
        t("type"),
        t("domain"),
        t("query"),
        t("externalId"),
        t("status"),
        t("duration"),
        t("cacheHit"),
      ]}
      rows={items.map((r) => (
        <TableRow key={r.id}>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {new Date(r.createdAt).toLocaleString(locale)}
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="capitalize">
              {r.type}
            </Badge>
          </TableCell>
          <TableCell className="font-mono text-xs">{r.domain}</TableCell>
          <TableCell className="max-w-xs truncate font-mono text-xs">
            {r.query ?? <span className="text-muted-foreground">-</span>}
          </TableCell>
          <TableCell className="font-mono text-xs">
            {r.externalId ?? <span className="text-muted-foreground">-</span>}
          </TableCell>
          <TableCell>
            <Badge variant={statusVariant(r.status)} className="tabular-nums">
              {r.status}
            </Badge>
          </TableCell>
          <TableCell className="tabular-nums">{r.durationMs}ms</TableCell>
          <TableCell>
            {r.cacheHit ? (
              <Badge variant="info">{t("cacheHitYes")}</Badge>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </TableCell>
        </TableRow>
      ))}
      footerSlot={
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      }
    />
  );
}
```

Note the em-dash-looking `-` characters in the table cells are pre-existing UI copy (typographic dash for empty cells), keep them.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/_lib/use-debounced-value.ts "src/app/(admin)/request-history/request-history-client.tsx"
git commit -m "feat(ui): server-side pagination + search on request history"
```

---

### Task 8: Rename-history client rewiring

**Files:**

- Modify: `src/app/(admin)/rename-history/rename-history-client.tsx`

- [ ] **Step 1: Rewire the client**

Same pattern as Task 7. Full new file content:

```tsx
"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, ListChecks, Search } from "lucide-react";
import { apiFetch } from "@/app/_lib/api-client";
import { useDebouncedValue } from "@/app/_lib/use-debounced-value";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { HistoryPage } from "@/components/ui/history-page";
import { TablePagination } from "@/components/ui/table-pagination";

interface Row {
  id: string;
  originalTitle: string;
  rewrittenTitle: string;
  mediaType: string;
  createdAt: string;
}

export function RenameHistoryClient() {
  const t = useTranslations("history.rename");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());

  const data = useQuery<{ items: Row[]; total: number }>({
    queryKey: ["rename-history", page, pageSize, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        take: String(pageSize),
        skip: String((page - 1) * pageSize),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch(`/api/admin/rename-history?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  return (
    <HistoryPage
      title={t("title")}
      subtitle={t("subtitle")}
      listTitle={t("listTitle", { count: total })}
      listSubtitle={t("listSubtitle")}
      emptyTitle={t("emptyTitle")}
      emptyHint={t("emptyHint")}
      emptyIcon={<ListChecks className="h-5 w-5" />}
      isLoading={data.isLoading}
      isEmpty={items.length === 0}
      filterSlot={
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("filterPlaceholder")}
            className="pl-9"
          />
        </div>
      }
      columns={[t("createdAt"), t("mediaType"), t("originalTitle"), t("rewrittenTitle")]}
      rows={items.map((r) => (
        <TableRow key={r.id}>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {new Date(r.createdAt).toLocaleString(locale)}
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="capitalize">
              {r.mediaType}
            </Badge>
          </TableCell>
          <TableCell className="font-mono text-xs">{r.originalTitle}</TableCell>
          <TableCell className="font-mono text-xs">
            <span className="inline-flex items-center gap-2 text-foreground">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              {r.rewrittenTitle}
            </span>
          </TableCell>
        </TableRow>
      ))}
      footerSlot={
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      }
    />
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/rename-history/rename-history-client.tsx"
git commit -m "feat(ui): server-side pagination + search on rename history"
```

---

### Task 9: Settings → Advanced field

**Files:**

- Modify: `src/app/(admin)/settings/_components/advanced-tab.tsx` (after the `logRetentionDays` field block, ~line 107)

- [ ] **Step 1: Add the form field**

In `advanced-tab.tsx`, directly after the closing `</div>` of the `logRetentionDays` field block, add:

```tsx
<div className="space-y-2">
  <div className="flex items-center gap-1.5">
    <Label htmlFor="historyRetentionDays">{t("historyRetentionDays")}</Label>
    <FieldHint text={t("historyRetentionDaysHint")} />
  </div>
  <Input
    id="historyRetentionDays"
    type="number"
    min={1}
    max={365}
    {...form.register("historyRetentionDays", {
      valueAsNumber: true,
    })}
  />
</div>
```

No changes needed in `settings-types.ts` - `SettingsRow extends SettingsUpdate`, which now includes the field via the Zod schema.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/settings/_components/advanced-tab.tsx"
git commit -m "feat(settings): history retention field in advanced tab"
```

---

### Task 10: Changelog entry

**Files:**

- Modify: `src/lib/changelog.ts` (top of the `CHANGELOG` array)

- [ ] **Step 1: Add the entry**

Prepend to the `CHANGELOG` array (newest first). Keep the existing entry style; adjust the version label if the maintainer has a different next version planned:

```ts
  {
    version: "1.3.0",
    date: "2026-08-06",
    title: "1.3.0: History pagination & configurable retention",
    description:
      "Request and rename history are now fully browsable: server-side pagination with selectable page size, and search covers the whole retained period instead of only the newest rows. A new setting controls how long history is kept.",
    items: [
      {
        type: "feature",
        text: "Request history and rename history pages now paginate through all stored entries (page size 25/50/100/250) instead of showing only the most recent 50 rows.",
      },
      {
        type: "feature",
        text: "Searching and filtering on both history pages now runs server-side across the entire retention period.",
      },
      {
        type: "feature",
        text: "New setting \"History retention (days)\" under Settings → Advanced (default 30, 1–365): request and rename history older than this is cleaned up automatically every 6 hours. Previously these tables grew without limit.",
      },
    ],
  },
```

- [ ] **Step 2: Run the changelog test**

Run: `pnpm vitest run tests/unit/changelog.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/changelog.ts
git commit -m "feat(changelog): add entry for history pagination and retention"
```

---

### Task 11: Full verification

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS, no regressions.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. (Build catches Next.js client-component issues that typecheck alone misses.)

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run the dev stack (`pnpm dev` or the `dev-up` skill), open `http://localhost:5007/request-history`:

- Pagination bar shows below the table, page size select works, prev/next disabled at the edges.
- Typing in the search box queries the server (network tab shows `?take=…&skip=0&search=…`), resets to page 1.
- Settings → Advanced shows "Verlauf-Aufbewahrung (Tage)" with value 30; saving another value persists it.

- [ ] **Step 4: Final commit if anything was fixed**

```bash
git status
```

Expected: clean tree, all work committed.
