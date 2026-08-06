import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// IMPORTANT: This module sets DATABASE_URL at import time so the prisma client
// (constructed at first import of `@/lib/db`) targets the test SQLite. Every
// API test file must import this module BEFORE any other module that imports
// `@/lib/db` directly or transitively.

const TEST_DB_DIR = path.join(process.cwd(), "tests", ".tmp");
// Vitest spawns multiple workers in parallel; each gets its own SQLite file
// so concurrent test files cannot deadlock on the same DB. Falls back to a
// stable path when run outside the vitest pool.
const WORKER_SUFFIX = process.env.VITEST_POOL_ID ?? "default";
const TEST_DB_PATH = path.join(TEST_DB_DIR, `api-test-${WORKER_SUFFIX}.db`);
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

process.env.DATABASE_URL = TEST_DB_URL;
// Static CSRF secret skips the per-boot DB read in `ensureCsrfSecret`, which
// keeps tests independent of Setting-row state.
process.env.CSRF_SECRET ??= "test-csrf-secret-fixed-for-determinism-32b";

let pushed = false;

/**
 * Lazily creates the test SQLite (or wipes it if it exists) and applies the
 * current Prisma schema. Idempotent — every test file calls it via beforeAll.
 */
export async function ensureTestDb(): Promise<void> {
  if (pushed) return;
  if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  execSync("pnpm prisma db push --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "ignore",
  });
  pushed = true;
}

/**
 * Truncates every model so a test starts from a known-empty state.
 * Order respects child→parent foreign-key direction.
 */
export async function cleanDb(): Promise<void> {
  const { prisma } = await import("@/lib/db");
  await prisma.session.deleteMany({});
  await prisma.searchItem.deleteMany({});
  await prisma.titleTranslation.deleteMany({});
  await prisma.titleApiCache.deleteMany({});
  await prisma.syncRun.deleteMany({});
  await prisma.requestHistory.deleteMany({});
  await prisma.renameHistory.deleteMany({});
  await prisma.logEntry.deleteMany({});
  await prisma.arrInstance.deleteMany({});
  await prisma.adminUser.deleteMany({});
  await prisma.plugin.deleteMany({});
  await prisma.setting.deleteMany({});
  // seedPlugins() is now guarded to run once per process (see
  // src/server/plugins/seed.ts). Without this reset, only the first test in
  // a file would ever re-seed the Plugin table just wiped above — every
  // later test in the file would run against an empty Plugin table /
  // language pack, a latent order-dependency across the ~9 API test files
  // that call cleanDb() between tests.
  const { resetSeedGuardForTests } = await import("@/server/plugins/seed");
  resetSeedGuardForTests();
}
