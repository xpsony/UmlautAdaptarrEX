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
