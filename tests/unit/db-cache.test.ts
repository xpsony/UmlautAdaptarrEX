import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCache, mockTrans, mockTransaction } = vi.hoisted(() => ({
  mockCache: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  mockTrans: {
    upsert: vi.fn(),
  },
  // Mirrors Prisma's array-form $transaction: run every op and resolve with
  // their results. Individual ops (mockCache.upsert / mockTrans.upsert) are
  // already invoked synchronously when the array is built, matching how the
  // real client kicks off queued PrismaPromises before $transaction awaits
  // them.
  mockTransaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    titleApiCache: mockCache,
    titleTranslation: mockTrans,
    $transaction: mockTransaction,
  },
}));

import { DbCachedTitleProvider } from "@/providers/db-cache";
import { makeTitlePayload, type TitlePayload, type TitleProvider } from "@/providers/types";

function makeInner(overrides: Partial<TitleProvider> = {}): TitleProvider & {
  fetchByExternalId: ReturnType<typeof vi.fn>;
  fetchByTitle: ReturnType<typeof vi.fn>;
  fetchBulk: ReturnType<typeof vi.fn>;
} {
  return {
    name: "stub",
    supportedLanguages: () => ["de"],
    fetchByExternalId: vi.fn(),
    fetchByTitle: vi.fn(),
    fetchBulk: vi.fn(),
    ...overrides,
  } as never;
}

function resetMocks(): void {
  for (const m of [mockCache.findUnique, mockCache.findMany, mockCache.upsert]) {
    m.mockReset();
  }
  mockTrans.upsert.mockReset();
  // mockReset() also drops the default implementation, so restore the
  // Prisma-array-form passthrough every test relies on unless it overrides it.
  mockTransaction.mockReset();
  mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
}

beforeEach(resetMocks);

afterEach(resetMocks);

describe("DbCachedTitleProvider metadata", () => {
  it("decorates the inner provider name", () => {
    const inner = makeInner();
    const cached = new DbCachedTitleProvider(inner);
    expect(cached.name).toBe("db-cached(stub)");
  });

  it("delegates supportedLanguages to the inner provider", () => {
    const inner = makeInner({ supportedLanguages: () => ["de", "fr"] });
    expect(new DbCachedTitleProvider(inner).supportedLanguages()).toEqual(["de", "fr"]);
  });

  it("does not cache fetchByTitle calls", async () => {
    const inner = makeInner();
    inner.fetchByTitle.mockResolvedValueOnce(makeTitlePayload({ titlesByLang: { de: "x" } }));
    const cached = new DbCachedTitleProvider(inner);
    await cached.fetchByTitle("tv", "X");
    expect(inner.fetchByTitle).toHaveBeenCalledOnce();
    expect(mockCache.findUnique).not.toHaveBeenCalled();
  });
});

describe("DbCachedTitleProvider.fetchByExternalId", () => {
  it("returns the inner result and persists when no cache row exists", async () => {
    mockCache.findUnique.mockResolvedValueOnce(null);
    mockCache.upsert.mockResolvedValueOnce({});
    mockTrans.upsert.mockResolvedValue({});
    const fresh = makeTitlePayload({ titlesByLang: { de: "Realm of Ravens" } });
    const inner = makeInner();
    inner.fetchByExternalId.mockResolvedValueOnce(fresh);

    const cached = new DbCachedTitleProvider(inner);
    const result = await cached.fetchByExternalId("tv", "12345", ["de"]);

    expect(result).toBe(fresh);
    expect(inner.fetchByExternalId).toHaveBeenCalledWith("tv", "12345", ["de"]);
    expect(mockCache.upsert).toHaveBeenCalledOnce();
    expect(mockTrans.upsert).toHaveBeenCalled();
  });

  it("returns the cached payload when fresh and the requested langs are covered", async () => {
    mockCache.findUnique.mockResolvedValueOnce({
      id: "tv:12345",
      expiresAt: null,
      translations: [
        {
          lang: "de",
          title: "Realm of Ravens",
          aliasesJson: JSON.stringify(["RoR"]),
        },
      ],
    });
    const inner = makeInner();
    const cached = new DbCachedTitleProvider(inner);
    const result = await cached.fetchByExternalId("tv", "12345", ["de"]);
    expect(result?.germanTitle).toBe("Realm of Ravens");
    expect(result?.aliases).toEqual(["RoR"]);
    expect(inner.fetchByExternalId).not.toHaveBeenCalled();
  });

  it("calls the inner provider when the cache row is expired", async () => {
    mockCache.findUnique.mockResolvedValueOnce({
      id: "tv:12345",
      expiresAt: new Date(Date.now() - 1000),
      translations: [],
    });
    mockCache.upsert.mockResolvedValueOnce({});
    mockTrans.upsert.mockResolvedValue({});
    const inner = makeInner();
    inner.fetchByExternalId.mockResolvedValueOnce(null);

    const cached = new DbCachedTitleProvider(inner);
    const result = await cached.fetchByExternalId("tv", "12345", ["de"]);

    expect(result).toBeNull();
    expect(inner.fetchByExternalId).toHaveBeenCalledOnce();
  });

  it("calls the inner provider when the cache misses a requested language", async () => {
    mockCache.findUnique.mockResolvedValueOnce({
      id: "tv:12345",
      expiresAt: null,
      translations: [{ lang: "de", title: "X", aliasesJson: null }],
    });
    mockCache.upsert.mockResolvedValueOnce({});
    mockTrans.upsert.mockResolvedValue({});
    const inner = makeInner();
    inner.fetchByExternalId.mockResolvedValueOnce(
      makeTitlePayload({ titlesByLang: { de: "X", fr: "Le X" } }),
    );

    const cached = new DbCachedTitleProvider(inner);
    const result = await cached.fetchByExternalId("tv", "12345", ["de", "fr"]);

    expect(inner.fetchByExternalId).toHaveBeenCalledOnce();
    expect(result?.titlesByLang).toMatchObject({ de: "X", fr: "Le X" });
  });

  it("treats '*' lang request as fully covered", async () => {
    mockCache.findUnique.mockResolvedValueOnce({
      id: "tv:1",
      expiresAt: null,
      translations: [{ lang: "de", title: "X", aliasesJson: null }],
    });
    const inner = makeInner();
    const cached = new DbCachedTitleProvider(inner);
    await cached.fetchByExternalId("tv", "1", ["*"]);
    expect(inner.fetchByExternalId).not.toHaveBeenCalled();
  });

  it("swallows persistence failures so a cache write never aborts the response", async () => {
    mockCache.findUnique.mockResolvedValueOnce(null);
    mockCache.upsert.mockRejectedValueOnce(new Error("io"));
    const inner = makeInner();
    const fresh = makeTitlePayload({ titlesByLang: { de: "X" } });
    inner.fetchByExternalId.mockResolvedValueOnce(fresh);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cached = new DbCachedTitleProvider(inner);

    const result = await cached.fetchByExternalId("tv", "1", ["de"]);
    expect(result).toBe(fresh);

    consoleSpy.mockRestore();
  });

  it("persists via a single $transaction covering the parent upsert plus one upsert per language", async () => {
    mockCache.findUnique.mockResolvedValueOnce(null);
    mockCache.upsert.mockResolvedValueOnce({});
    mockTrans.upsert.mockResolvedValue({});
    const inner = makeInner();
    inner.fetchByExternalId.mockResolvedValueOnce(
      makeTitlePayload({ titlesByLang: { de: "X", fr: "Le X" } }),
    );
    const cached = new DbCachedTitleProvider(inner);

    await cached.fetchByExternalId("tv", "1", ["de", "fr"]);

    expect(mockTransaction).toHaveBeenCalledOnce();
    const ops = mockTransaction.mock.calls[0]?.[0] as unknown[];
    // 1 parent upsert + 2 translation upserts (de, fr).
    expect(ops).toHaveLength(3);
    expect(mockCache.upsert).toHaveBeenCalledOnce();
    expect(mockTrans.upsert).toHaveBeenCalledTimes(2);
  });

  it("routes persistence failures to an injected structural logger instead of console.error", async () => {
    mockCache.findUnique.mockResolvedValueOnce(null);
    mockCache.upsert.mockRejectedValueOnce(new Error("io"));
    const inner = makeInner();
    const fresh = makeTitlePayload({ titlesByLang: { de: "X" } });
    inner.fetchByExternalId.mockResolvedValueOnce(fresh);
    const logger = { error: vi.fn() };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cached = new DbCachedTitleProvider(inner, logger);

    const result = await cached.fetchByExternalId("tv", "1", ["de"]);

    expect(result).toBe(fresh);
    expect(logger.error).toHaveBeenCalledWith(
      { id: "tv:1", err: expect.any(Error) },
      "db-cache: titleApiCache upsert failed",
    );
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("DbCachedTitleProvider.fetchBulk", () => {
  it("returns an empty map for an empty id list", async () => {
    const inner = makeInner();
    const cached = new DbCachedTitleProvider(inner);
    expect((await cached.fetchBulk("tv", [])).size).toBe(0);
    expect(inner.fetchBulk).not.toHaveBeenCalled();
  });

  it("serves all ids from cache when fresh and covering", async () => {
    mockCache.findMany.mockResolvedValueOnce([
      {
        id: "tv:1",
        expiresAt: null,
        translations: [{ lang: "de", title: "Eins", aliasesJson: null }],
      },
      {
        id: "tv:2",
        expiresAt: null,
        translations: [{ lang: "de", title: "Zwei", aliasesJson: null }],
      },
    ]);
    const inner = makeInner();
    const cached = new DbCachedTitleProvider(inner);
    const out = await cached.fetchBulk("tv", ["1", "2"], ["de"]);
    expect(out.size).toBe(2);
    expect(out.get("1")?.germanTitle).toBe("Eins");
    expect(inner.fetchBulk).not.toHaveBeenCalled();
  });

  it("only forwards the missing ids to the inner provider", async () => {
    mockCache.findMany.mockResolvedValueOnce([
      {
        id: "tv:1",
        expiresAt: null,
        translations: [{ lang: "de", title: "Eins", aliasesJson: null }],
      },
    ]);
    mockCache.upsert.mockResolvedValue({});
    mockTrans.upsert.mockResolvedValue({});
    const inner = makeInner();
    inner.fetchBulk.mockResolvedValueOnce(
      new Map([["2", makeTitlePayload({ titlesByLang: { de: "Zwei" } })]]),
    );

    const cached = new DbCachedTitleProvider(inner);
    const out = await cached.fetchBulk("tv", ["1", "2"], ["de"]);

    // DbCache now passes an opts object so the inner provider can stream
    // per-id results back for incremental persistence.
    expect(inner.fetchBulk).toHaveBeenCalledWith(
      "tv",
      ["2"],
      ["de"],
      expect.objectContaining({ onItem: expect.any(Function) }),
    );
    expect(out.size).toBe(2);
  });

  it("persists each id as soon as the inner provider streams it (no end-of-bulk batching)", async () => {
    mockCache.findMany.mockResolvedValueOnce([]);
    mockCache.upsert.mockResolvedValue({});
    mockTrans.upsert.mockResolvedValue({});
    const inner = makeInner();
    // Drive the streaming callback ourselves so we can assert that persist
    // happens before the inner promise resolves.
    const upsertOrder: string[] = [];
    mockCache.upsert.mockImplementation(async ({ where }) => {
      upsertOrder.push(where.id);
      return {};
    });
    inner.fetchBulk.mockImplementationOnce(
      async (_type: string, ids: string[], _langs?: string[], opts?: any) => {
        const result = new Map<string, TitlePayload>();
        for (const id of ids) {
          const payload = makeTitlePayload({
            titlesByLang: { de: `T${id}` },
            externalId: id,
          });
          result.set(id, payload);
          await opts?.onItem?.(id, payload);
        }
        return result;
      },
    );

    const cached = new DbCachedTitleProvider(inner);
    const out = await cached.fetchBulk("tv", ["1", "2"], ["de"]);

    expect(out.size).toBe(2);
    // Two ids streamed -> two parent upserts, each fired during the inner
    // call (not in a single end-of-bulk pass). Per-id persist via the
    // callback already covers both ids, so the post-loop fallback writes
    // nothing extra.
    expect(upsertOrder).toEqual(["tv:1", "tv:2"]);
    expect(mockCache.upsert).toHaveBeenCalledTimes(2);
  });

  it("excludes negative cache hits from the result map", async () => {
    mockCache.findMany.mockResolvedValueOnce([
      {
        id: "tv:1",
        expiresAt: null,
        translations: [{ lang: "de", title: null, aliasesJson: null }],
      },
    ]);
    const inner = makeInner();
    inner.fetchBulk.mockResolvedValueOnce(new Map<string, TitlePayload>());
    const cached = new DbCachedTitleProvider(inner);
    const out = await cached.fetchBulk("tv", ["1"], ["de"]);
    expect(out.has("1")).toBe(false);
  });
});
