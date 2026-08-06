import { prisma } from "@/lib/db";
import { BUILTIN_PLUGINS } from "@/domain/plugins";

// `reloadSettings()` calls `reloadPlugins()` → `seedPlugins()` on every
// settings-PUT and plugin pause/toggle, not just at boot. The upserts are
// idempotent no-ops after the first run (existing rows keep whatever the
// user toggled them to), so re-running them on every request is pure waste —
// this guard makes seeding a true once-per-process operation instead of a
// once-per-reload one.
let seeded = false;

// Ensure every built-in plugin has a row in `Plugin`. Existing rows keep
// whatever the user toggled them to. Plugins removed from the registry are
// left in DB untouched (cheap and forward-compatible if they are reintroduced).
export async function seedPlugins(): Promise<void> {
  if (seeded) return;
  for (const plugin of BUILTIN_PLUGINS) {
    await prisma.plugin.upsert({
      where: { id: plugin.id },
      create: { id: plugin.id, enabled: plugin.defaultEnabled },
      update: {},
    });
  }
  seeded = true;
}

// Test-only escape hatch: each vitest test file gets a fresh module instance,
// but multiple `it()` blocks within the same file share this module's state.
// Call this in `beforeEach`/`afterEach` when a test needs to observe
// `seedPlugins()` running again.
export function resetSeedGuardForTests(): void {
  seeded = false;
}

export async function loadActivePlugins(): Promise<string[]> {
  const rows = await prisma.plugin.findMany({ where: { enabled: true } });
  return rows.map((r) => r.id);
}
