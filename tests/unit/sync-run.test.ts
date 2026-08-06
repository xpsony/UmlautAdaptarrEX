import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    syncRun: { update: vi.fn() },
    arrInstance: { update: vi.fn() },
    searchItem: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    titleOverride: { findMany: vi.fn() },
    titleApiCache: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

const { mockState } = vi.hoisted(() => ({
  mockState: {
    languagePack: {
      activePlugins: [] as Array<{ id: string; language: string }>,
    },
    tmdbAvailable: true,
    settings: { userAgent: "UA" },
    providerForOrder: vi.fn(),
    removeItemsForInstance: vi.fn(),
    indexItem: vi.fn(),
  },
}));

vi.mock("@/server/state", () => ({
  getAppState: () => mockState,
}));

const { mockBuild } = vi.hoisted(() => ({
  mockBuild: vi.fn(),
}));

vi.mock("@/arr", () => ({
  buildArrClient: mockBuild,
}));

vi.mock("@/providers", () => ({
  requiredLanguages: (pack: { activePlugins: Array<{ language: string }> }) => {
    const set = new Set<string>();
    for (const p of pack.activePlugins) set.add(p.language);
    return [...set];
  },
}));

import { runSync } from "@/server/sync/run";
import { aggregatePlugins, getActiveLanguagePack, setActiveLanguagePack } from "@/domain/plugins";
import { germanUmlauts } from "@/domain/plugins/german-umlauts/index.js";
import { swedishUmlauts } from "@/domain/plugins/swedish-umlauts/index.js";

interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
}

function makeLogger(): MockLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
}

function makePrepared(
  type: "sonarr" | "radarr" | "lidarr" | "readarr",
  overrides: Partial<{ apiKey: string; providerOrder: string | null }> = {},
) {
  return {
    runId: `run-${type}`,
    instance: {
      id: `inst-${type}`,
      name: `${type} 1`,
      type,
      host: `http://${type}.local`,
      apiKey: "real-api-key",
      enabled: true,
      providerOrder: type === "sonarr" || type === "radarr" ? "pcjones" : null,
      ...overrides,
    },
  };
}

beforeEach(() => {
  for (const m of [
    mockPrisma.syncRun.update,
    mockPrisma.arrInstance.update,
    mockPrisma.searchItem.findMany,
    mockPrisma.searchItem.update,
    mockPrisma.searchItem.create,
    mockPrisma.searchItem.deleteMany,
  ]) {
    m.mockReset();
  }
  mockPrisma.titleOverride.findMany.mockReset();
  mockPrisma.titleOverride.findMany.mockResolvedValue([]);
  mockPrisma.titleApiCache.findMany.mockReset();
  mockPrisma.titleApiCache.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockReset();
  mockState.providerForOrder.mockReset();
  mockState.removeItemsForInstance.mockReset();
  mockState.indexItem.mockReset();
  mockState.tmdbAvailable = true;
  mockState.languagePack.activePlugins = [];
  mockBuild.mockReset();

  mockPrisma.syncRun.update.mockResolvedValue({});
  mockPrisma.arrInstance.update.mockResolvedValue({});
});

afterEach(() => {
  mockPrisma.$transaction.mockReset();
  mockBuild.mockReset();
});

describe("runSync TMDB preflight", () => {
  it("aborts every prepared run when non-DE plugin is enabled but no TMDB key is set", async () => {
    mockState.tmdbAvailable = false;
    mockState.languagePack.activePlugins = [{ id: "swedish-umlauts", language: "sv" }];

    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("sonarr"), makePrepared("radarr")],
    });

    expect(result.totalItems).toBe(0);
    expect(result.perInstance).toHaveLength(2);
    expect(result.perInstance.every((p) => p.error)).toBe(true);
    expect(mockPrisma.syncRun.update).toHaveBeenCalledTimes(2);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("does not abort when only the DE plugin is active", async () => {
    mockState.tmdbAvailable = false;
    mockState.languagePack.activePlugins = [{ id: "german-umlauts", language: "de" }];
    mockState.providerForOrder.mockReturnValueOnce({ name: "stub" });
    mockBuild.mockReturnValueOnce({ fetchAllItems: async () => [] });
    mockPrisma.searchItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockPrisma.$transaction.mockImplementationOnce(
      async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
        await cb(mockPrisma);
      },
    );

    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("sonarr")],
    });
    expect(result.perInstance[0]?.error).toBeUndefined();
  });
});

describe("runSync per-instance handling", () => {
  it("marks a sonarr instance failed when no provider can be built", async () => {
    mockState.providerForOrder.mockReturnValueOnce(null);
    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("sonarr")],
    });
    expect(result.perInstance[0]?.error).toMatch(/No title provider/);
    // updateInstance: false → arrInstance.update NOT called for this branch.
    expect(mockPrisma.arrInstance.update).not.toHaveBeenCalled();
  });

  it("marks an instance failed when the api key is the Prowlarr mask", async () => {
    mockState.providerForOrder.mockReturnValueOnce({ name: "stub" });
    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("sonarr", { apiKey: "*".repeat(32) })],
    });
    expect(result.perInstance[0]?.error).toMatch(/Prowlarr mask/);
  });

  it("falls through to a successful sync when fetch returns items", async () => {
    mockState.providerForOrder.mockReturnValueOnce({ name: "stub" });
    mockBuild.mockReturnValueOnce({
      fetchAllItems: async () => [
        {
          arrId: 1,
          externalId: "t1",
          title: "A",
          expectedTitle: "A",
          expectedAuthor: null,
          germanTitle: "Ä",
          mediaType: "tv",
          titleSearchVariations: ["A"],
          titleMatchVariations: ["A"],
          authorMatchVariations: [],
          aliases: null,
        },
      ],
    });
    mockPrisma.searchItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "row1",
        arrInstanceId: "inst-sonarr",
        arrId: 1,
        externalId: "t1",
        title: "A",
        expectedTitle: "A",
        expectedAuthor: null,
        germanTitle: "Ä",
        mediaType: "tv",
        titleSearchVariations: '["A"]',
        titleMatchVariations: '["A"]',
        authorMatchVariations: "[]",
      },
    ]);
    mockPrisma.$transaction.mockImplementationOnce(
      async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
        await cb(mockPrisma);
      },
    );

    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("sonarr")],
    });

    expect(result.totalItems).toBe(1);
    expect(result.perInstance[0]?.error).toBeUndefined();
    expect(result.perInstance[0]?.count).toBe(1);
  });

  it("catches a fetch exception and marks the run as errored", async () => {
    mockState.providerForOrder.mockReturnValueOnce({ name: "stub" });
    mockBuild.mockReturnValueOnce({
      fetchAllItems: async () => {
        throw new Error("upstream timeout");
      },
    });

    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("sonarr")],
    });

    expect(result.perInstance[0]?.error).toMatch(/upstream timeout/);
    expect(mockPrisma.arrInstance.update).toHaveBeenCalled();
  });
});

describe("runSync status-write hardening", () => {
  it("still resolves with a failed-run result and logs an error when syncRun.update rejects on failure", async () => {
    mockState.providerForOrder.mockReturnValueOnce({ name: "stub" });
    mockBuild.mockReturnValueOnce({
      fetchAllItems: async () => {
        throw new Error("upstream timeout");
      },
    });
    mockPrisma.syncRun.update.mockRejectedValueOnce(new Error("db locked"));

    const logger = makeLogger();
    const result = await runSync({
      logger: logger as never,
      preparedRuns: [makePrepared("sonarr")],
    });

    // The in-memory result must survive even though the status write failed.
    expect(result.perInstance[0]?.error).toMatch(/upstream timeout/);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-sonarr" }),
      expect.stringContaining("run-failed"),
    );
  });

  it("still resolves with a succeeded-run result and logs an error when syncRun.update rejects on success", async () => {
    mockState.providerForOrder.mockReturnValueOnce({ name: "stub" });
    mockBuild.mockReturnValueOnce({ fetchAllItems: async () => [] });
    mockPrisma.searchItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockPrisma.$transaction.mockImplementationOnce(
      async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
        await cb(mockPrisma);
      },
    );
    mockPrisma.syncRun.update.mockRejectedValueOnce(new Error("db locked"));

    const logger = makeLogger();
    const result = await runSync({
      logger: logger as never,
      preparedRuns: [makePrepared("sonarr")],
    });

    expect(result.perInstance[0]?.error).toBeUndefined();
    expect(result.perInstance[0]?.count).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-sonarr" }),
      expect.stringContaining("run-succeeded"),
    );
  });
});

describe("runSync provider-order parsing", () => {
  it("treats invalid CSV provider order as null and still succeeds for lidarr", async () => {
    // lidarr does not need a provider; an unparseable order is irrelevant.
    mockBuild.mockReturnValueOnce({ fetchAllItems: async () => [] });
    mockPrisma.searchItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockPrisma.$transaction.mockImplementationOnce(
      async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
        await cb(mockPrisma);
      },
    );

    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("lidarr", { providerOrder: "garbage,not-real" })],
    });
    expect(result.perInstance[0]?.error).toBeUndefined();
  });
});

describe("runSync persistAndReindex dedup", () => {
  it("drops items with duplicate externalId before persisting so a stray collision does not crash the chunk", async () => {
    // Two items with the same externalId would violate
    // @@unique([arrInstanceId, externalId]) inside one transaction. The
    // dedup keeps only the first occurrence.
    mockBuild.mockReturnValueOnce({
      fetchAllItems: async () => [
        {
          arrId: 1,
          externalId: "dup",
          title: "A",
          expectedTitle: "A",
          expectedAuthor: "Artist X",
          germanTitle: null,
          mediaType: "audio",
          titleSearchVariations: ["A"],
          titleMatchVariations: ["A"],
          authorMatchVariations: [],
          aliases: null,
        },
        {
          arrId: 2,
          externalId: "dup",
          title: "A",
          expectedTitle: "A",
          expectedAuthor: "Artist Y",
          germanTitle: null,
          mediaType: "audio",
          titleSearchVariations: ["A"],
          titleMatchVariations: ["A"],
          authorMatchVariations: [],
          aliases: null,
        },
      ],
    });
    mockPrisma.searchItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    let createCalls = 0;
    mockPrisma.$transaction.mockImplementationOnce(
      async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
        const tx = {
          ...mockPrisma,
          searchItem: {
            ...mockPrisma.searchItem,
            create: vi.fn(() => {
              createCalls += 1;
              return Promise.resolve({});
            }),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        await cb(tx as unknown as typeof mockPrisma);
      },
    );

    const result = await runSync({
      logger: makeLogger() as never,
      preparedRuns: [makePrepared("lidarr")],
    });

    expect(result.perInstance[0]?.error).toBeUndefined();
    // Even though fetchAllItems returned 2 entries with the same externalId,
    // only one create runs because the second was dropped as a duplicate.
    expect(createCalls).toBe(1);
    // count reflects the deduped size, not the raw payload.
    expect(result.perInstance[0]?.count).toBe(1);
  });
});

// Helper: run a single-instance sync and capture the `data` payload passed
// to searchItem.create for every persisted item, keyed by externalId.
async function runSyncAndCaptureCreates(
  fetchedItems: Array<Record<string, unknown>>,
): Promise<Map<string, Record<string, unknown>>> {
  mockState.providerForOrder.mockReturnValueOnce({ name: "stub" });
  mockBuild.mockReturnValueOnce({
    fetchAllItems: async () => fetchedItems,
  });
  mockPrisma.searchItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  const created = new Map<string, Record<string, unknown>>();
  mockPrisma.$transaction.mockImplementationOnce(
    async (cb: (tx: typeof mockPrisma) => Promise<void>) => {
      const tx = {
        ...mockPrisma,
        searchItem: {
          ...mockPrisma.searchItem,
          create: vi.fn((args: { data: Record<string, unknown> }) => {
            created.set(args.data.externalId as string, args.data);
            return Promise.resolve({});
          }),
        },
      };
      await cb(tx as unknown as typeof mockPrisma);
    },
  );

  const result = await runSync({
    logger: makeLogger() as never,
    preparedRuns: [makePrepared("sonarr")],
  });
  expect(result.perInstance[0]?.error).toBeUndefined();
  return created;
}

describe("runSync title overrides", () => {
  it("re-derives an overridden item so the persisted germanTitle and variations reflect the override", async () => {
    mockPrisma.titleOverride.findMany.mockResolvedValueOnce([
      { mediaType: "tv", externalId: "42", germanTitle: "Override-Titel" },
    ]);
    const created = await runSyncAndCaptureCreates([
      {
        arrId: 1,
        externalId: "42",
        title: "Dark",
        expectedTitle: "Dark",
        expectedAuthor: null,
        germanTitle: "Provider-Titel",
        mediaType: "tv",
        titleSearchVariations: ["Dark"],
        titleMatchVariations: ["Dark"],
        authorMatchVariations: [],
        aliases: null,
      },
    ]);

    const item = created.get("42");
    expect(item?.germanTitle).toBe("Override-Titel");
    expect(JSON.parse(item?.titleSearchVariations as string)).toContain("Override-Titel");
  });

  it("leaves an item without a matching override untouched even when other overrides exist", async () => {
    mockPrisma.titleOverride.findMany.mockResolvedValueOnce([
      { mediaType: "tv", externalId: "42", germanTitle: "Override-Titel" },
    ]);
    const created = await runSyncAndCaptureCreates([
      {
        arrId: 2,
        externalId: "99",
        title: "Other",
        expectedTitle: "Other",
        expectedAuthor: null,
        germanTitle: "Anderer-Titel",
        mediaType: "tv",
        titleSearchVariations: ["Other"],
        titleMatchVariations: ["Other"],
        authorMatchVariations: [],
        aliases: null,
      },
    ]);

    const item = created.get("99");
    expect(item?.germanTitle).toBe("Anderer-Titel");
    // Unchanged from the fake fixture array — proves no re-derivation ran
    // for this item (a real buildSearchItem call over "Other" would not
    // round-trip to exactly ["Other"]).
    expect(JSON.parse(item?.titleSearchVariations as string)).toEqual(["Other"]);
  });

  it("passes every item through identically when there are no overrides at all", async () => {
    mockPrisma.titleOverride.findMany.mockResolvedValueOnce([]);
    const created = await runSyncAndCaptureCreates([
      {
        arrId: 1,
        externalId: "1",
        title: "A",
        expectedTitle: "A",
        expectedAuthor: null,
        germanTitle: "Ä",
        mediaType: "tv",
        titleSearchVariations: ["A"],
        titleMatchVariations: ["A"],
        authorMatchVariations: [],
        aliases: null,
      },
    ]);

    const item = created.get("1");
    expect(item?.germanTitle).toBe("Ä");
    // No re-derivation: the fake fixture arrays survive verbatim, which
    // would not happen if buildSearchItem ran (it never emits a
    // single-element array equal to the raw fixture for real inputs).
    expect(JSON.parse(item?.titleSearchVariations as string)).toEqual(["A"]);
    expect(JSON.parse(item?.titleMatchVariations as string)).toEqual(["A"]);
  });

  it("carries expectedAuthor through re-derivation for overridden audio/book items", async () => {
    // Lidarr/Readarr items never carry a provider germanTitle. With an
    // override present, re-derivation persists one — expected and
    // acceptable (see run.ts comment) — but expectedAuthor must still flow
    // through so the books/audio variation path keeps its author variations.
    mockPrisma.titleOverride.findMany.mockResolvedValueOnce([
      { mediaType: "audio", externalId: "a1", germanTitle: "Album Override" },
    ]);
    const created = await runSyncAndCaptureCreates([
      {
        arrId: 1,
        externalId: "a1",
        title: "Best Of",
        expectedTitle: "Best Of",
        expectedAuthor: "Artist X",
        germanTitle: null,
        mediaType: "audio",
        titleSearchVariations: ["Best Of"],
        titleMatchVariations: ["Best Of"],
        authorMatchVariations: ["Artist X"],
        aliases: null,
      },
    ]);

    const item = created.get("a1");
    expect(item?.germanTitle).toBe("Album Override");
    expect(JSON.parse(item?.authorMatchVariations as string).length).toBeGreaterThan(0);
  });

  it("sources titlesByLang from the TitleApiCache so non-DE plugin variations survive an override", async () => {
    // Activate the Swedish plugin alongside the default German one so a
    // real (non-mocked) buildSearchItem call actually emits an sv variation
    // when fed titlesByLang.sv — proving the fix end-to-end via the
    // persisted variations, not just via a spy on the call args.
    const originalPack = getActiveLanguagePack();
    setActiveLanguagePack(aggregatePlugins([germanUmlauts, swedishUmlauts]));
    try {
      mockPrisma.titleOverride.findMany.mockResolvedValueOnce([
        { mediaType: "tv", externalId: "42", germanTitle: "Override-Titel" },
      ]);
      mockPrisma.titleApiCache.findMany.mockResolvedValueOnce([
        {
          id: "tv:42",
          translations: [
            { lang: "de", title: "Cache-DE" },
            { lang: "sv", title: "Sverige-Titel" },
          ],
        },
      ]);
      const created = await runSyncAndCaptureCreates([
        {
          arrId: 1,
          externalId: "42",
          title: "Dark",
          expectedTitle: "Dark",
          expectedAuthor: null,
          germanTitle: "Provider-Titel",
          mediaType: "tv",
          titleSearchVariations: ["Dark"],
          titleMatchVariations: ["Dark"],
          authorMatchVariations: [],
          aliases: null,
        },
      ]);

      // Cache lookup is bounded to the overridden item's key, not the whole
      // library.
      expect(mockPrisma.titleApiCache.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["tv:42"] } },
        include: { translations: { select: { lang: true, title: true } } },
      });

      const item = created.get("42");
      const variations = JSON.parse(item?.titleSearchVariations as string) as string[];
      // The override wins the "de" slot — the stale cached German title
      // never appears...
      expect(item?.germanTitle).toBe("Override-Titel");
      expect(variations).not.toContain("Cache-DE");
      expect(variations).toContain("Override-Titel");
      // ...but the cache-sourced Swedish translation still made it through,
      // proving titlesByLang carries more than just the pinned "de" entry.
      expect(variations).toContain("Sverige-Titel");
    } finally {
      setActiveLanguagePack(originalPack);
    }
  });
});
