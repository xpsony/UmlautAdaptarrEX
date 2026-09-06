import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { E2E_PATHS } from "../../../playwright.config";

// Wipes the test SQLite and runs `prisma migrate deploy` against it before
// Playwright starts the dev webServer. Runs in the Playwright runner process,
// so any env we mutate here only affects the prisma subprocess we spawn -
// the webServer itself receives DATABASE_URL via its own `env` block in
// `playwright.config.ts`.
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const { testDbPath, testDbUrl, storageStatePath } = E2E_PATHS;

  const dataDir = path.dirname(testDbPath);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  for (const candidate of [
    testDbPath,
    `${testDbPath}-journal`,
    `${testDbPath}-wal`,
    `${testDbPath}-shm`,
  ]) {
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }

  const authDir = path.dirname(storageStatePath);
  if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });
  if (existsSync(storageStatePath)) rmSync(storageStatePath, { force: true });

  // `prisma migrate deploy` reads DATABASE_URL from env. Pinning it here
  // means the migration lands on the test DB even if a developer has a
  // `.env` exporting the dev DB.
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: path.resolve(path.dirname(testDbPath), ".."),
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy exited with status ${result.status} (signal=${result.signal ?? "none"})`,
    );
  }

  console.log(`[e2e] reset test DB at ${testDbPath}`);
}
