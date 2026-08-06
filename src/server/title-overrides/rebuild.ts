import { prisma } from "@/lib/db";
import { buildSearchItem, type SearchItemInput } from "@/domain/variations";
import type { MediaType } from "@/domain/variations/generate";
import { getAppState } from "@/server/state";

// Mirrors `parseAliasesJson` in `src/providers/db-cache.ts` — a corrupt
// `aliases` column must never abort the rebuild (and must not be parsed
// while holding the SQLite writer lock inside `$transaction`).
function parseAliasesJson(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Re-derives every SearchItem row for `mediaType`+`externalId` (across all
 * instances) after a title override changed. germanTitle resolution order:
 * override > cached "de" translation > null (next sync re-resolves). Runs
 * the untouched domain `buildSearchItem`, persists in one transaction, and
 * refreshes the in-memory index of each affected instance so the change is
 * searchable immediately.
 */
async function doRebuild(
  mediaType: MediaType,
  externalId: string,
): Promise<{ rebuiltItems: number }> {
  const rows = await prisma.searchItem.findMany({
    where: { mediaType, externalId },
  });
  if (rows.length === 0) return { rebuiltItems: 0 };

  const override = await prisma.titleOverride.findUnique({
    where: { mediaType_externalId: { mediaType, externalId } },
  });
  const cache = await prisma.titleApiCache.findUnique({
    where: { id: `${mediaType}:${externalId}` },
    include: { translations: { select: { lang: true, title: true } } },
  });

  const titlesByLang: Record<string, string> = {};
  for (const t of cache?.translations ?? []) {
    if (t.title) titlesByLang[t.lang] = t.title;
  }
  const germanTitle = override?.germanTitle ?? titlesByLang["de"] ?? null;
  // The override must win everywhere the "de" title is consumed — without
  // this, generateForTvMovie's `inputDe = titlesByLang?.de` would fall back
  // to the cached provider title and re-introduce it into the variations.
  if (override) titlesByLang["de"] = override.germanTitle;

  // Parse aliases up front (outside the transaction) so a single corrupt row
  // fails fast instead of throwing while the SQLite writer lock is held.
  const inputs: SearchItemInput[] = rows.map((row) => ({
    arrId: row.arrId,
    externalId: row.externalId,
    title: row.title,
    expectedTitle: row.expectedTitle,
    expectedAuthor: row.expectedAuthor,
    germanTitle,
    titlesByLang: Object.keys(titlesByLang).length > 0 ? titlesByLang : null,
    // `rows` is filtered by this exact `mediaType`, so reuse the already
    // narrowed parameter instead of re-casting the DB's untyped string column.
    mediaType,
    aliases: parseAliasesJson(row.aliases),
    year: row.year,
  }));

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const derived = buildSearchItem(inputs[i]!);
      await tx.searchItem.update({
        where: { id: row.id },
        data: {
          germanTitle: derived.germanTitle,
          titleSearchVariations: JSON.stringify(derived.titleSearchVariations),
          titleMatchVariations: JSON.stringify(derived.titleMatchVariations),
          authorMatchVariations: JSON.stringify(derived.authorMatchVariations),
          aliases: derived.aliases ? JSON.stringify(derived.aliases) : null,
        },
      });
    }
  });

  const state = getAppState();
  for (const instanceId of new Set(rows.map((r) => r.arrInstanceId))) {
    await state.reindexInstance(instanceId);
  }
  return { rebuiltItems: rows.length };
}

// Rebuilds mutate the shared in-memory index (remove → re-read → re-index);
// two interleaved runs could leave stale or duplicate entries. Serialize
// them through a queue — callers just await their turn. Note this only
// serializes rebuilds against each other, NOT against a running sync's
// persist phase: a PUT landing in that seconds-wide window can be
// overwritten with pre-override titles until the next sync re-applies the
// override (self-healing; accepted).
let rebuildQueue: Promise<unknown> = Promise.resolve();

export function rebuildSearchItemsFor(
  mediaType: MediaType,
  externalId: string,
): Promise<{ rebuiltItems: number }> {
  const run = rebuildQueue.then(() => doRebuild(mediaType, externalId));
  rebuildQueue = run.catch(() => {
    /* keep the chain alive after a failed rebuild */
  });
  return run;
}
