import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompositeTitleProvider } from "@/providers/index.js";
import { type SyncStats, withSyncStats } from "@/server/sync/stats.js";
import {
  makeTitlePayload,
  type TitlePayload,
  type TitleProvider,
} from "@/providers/types.js";
import type { MediaType } from "@/domain/variations/generate.js";

// Tests the user-order path of CompositeTitleProvider by stubbing the inner
// providers via vi.mock. Stubs return a per-language title and record the
// order they were called in.

const callOrder: string[] = [];

class StubProvider implements TitleProvider {
  constructor(
    public name: string,
    private titles: Record<string, string>,
  ) {}
  supportedLanguages(): readonly string[] {
    return ["*"];
  }
  async fetchByExternalId(
    _type: MediaType,
    externalId: string,
    langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    callOrder.push(this.name);
    const provided: Record<string, string> = {};
    for (const l of langs ?? ["de"]) {
      const v = this.titles[l];
      if (v) provided[l] = v;
    }
    if (Object.keys(provided).length === 0) return null;
    return makeTitlePayload({ titlesByLang: provided, externalId });
  }
  async fetchByTitle(
    _type: MediaType,
    _title: string,
    _langs?: readonly string[],
  ): Promise<TitlePayload | null> {
    return null;
  }
  async fetchBulk(
    _type: MediaType,
    ids: string[],
    langs?: readonly string[],
    _opts?: { onItem?: (id: string, p: TitlePayload) => void | Promise<void> },
  ): Promise<Map<string, TitlePayload>> {
    callOrder.push(this.name);
    const out = new Map<string, TitlePayload>();
    for (const id of ids) {
      const provided: Record<string, string> = {};
      for (const l of langs ?? ["de"]) {
        const v = this.titles[l];
        if (v) provided[l] = v;
      }
      if (Object.keys(provided).length > 0) {
        const payload = makeTitlePayload({
          titlesByLang: provided,
          externalId: id,
        });
        out.set(id, payload);
        await _opts?.onItem?.(id, payload);
      }
    }
    return out;
  }
}

vi.mock("@/providers/pcjones-api.js", () => ({
  PcjonesApiProvider: class {
    name = "pcjones";
    private inner: StubProvider;
    constructor() {
      this.inner = new StubProvider("pcjones", { de: "PcjonesTitel" });
    }
    supportedLanguages() {
      return this.inner.supportedLanguages();
    }
    fetchByExternalId(...args: Parameters<TitleProvider["fetchByExternalId"]>) {
      return this.inner.fetchByExternalId(...args);
    }
    fetchByTitle(...args: Parameters<TitleProvider["fetchByTitle"]>) {
      return this.inner.fetchByTitle(...args);
    }
    fetchBulk(...args: Parameters<TitleProvider["fetchBulk"]>) {
      return this.inner.fetchBulk(...args);
    }
  },
}));

vi.mock("@/providers/tmdb.js", () => ({
  looksLikeTmdbV4Token: () => false,
  TmdbProvider: class {
    name = "tmdb";
    private inner: StubProvider;
    constructor() {
      this.inner = new StubProvider("tmdb", {
        de: "TmdbTitel",
        sv: "TmdbSv",
        en: "TmdbEn",
      });
    }
    supportedLanguages() {
      return this.inner.supportedLanguages();
    }
    fetchByExternalId(...args: Parameters<TitleProvider["fetchByExternalId"]>) {
      return this.inner.fetchByExternalId(...args);
    }
    fetchByTitle(...args: Parameters<TitleProvider["fetchByTitle"]>) {
      return this.inner.fetchByTitle(...args);
    }
    fetchBulk(...args: Parameters<TitleProvider["fetchBulk"]>) {
      return this.inner.fetchBulk(...args);
    }
  },
}));

vi.mock("@/providers/tvdb.js", () => ({
  TvdbProvider: class {
    name = "tvdb";
    private inner: StubProvider;
    constructor() {
      this.inner = new StubProvider("tvdb", {
        de: "TvdbTitel",
        sv: "TvdbSv",
        en: "TvdbEn",
      });
    }
    supportedLanguages() {
      return this.inner.supportedLanguages();
    }
    fetchByExternalId(...args: Parameters<TitleProvider["fetchByExternalId"]>) {
      return this.inner.fetchByExternalId(...args);
    }
    fetchByTitle(...args: Parameters<TitleProvider["fetchByTitle"]>) {
      return this.inner.fetchByTitle(...args);
    }
    fetchBulk(...args: Parameters<TitleProvider["fetchBulk"]>) {
      return this.inner.fetchBulk(...args);
    }
  },
}));

function buildComposite(order: ("pcjones" | "tvdb" | "tmdb")[]) {
  return new CompositeTitleProvider({
    titleApiHost: "http://example.invalid",
    tmdbApiKey: "abcdef0123456789",
    tvdbApiKey: "tvdb-key",
    userAgent: "test",
    providerOrder: order,
  });
}

describe("CompositeTitleProvider - User-Order Routing", () => {
  beforeEach(() => {
    callOrder.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses pcjones first when DE is requested and pcjones leads the order", async () => {
    const c = buildComposite(["pcjones", "tvdb", "tmdb"]);
    const stats: SyncStats = await withSyncStats(async (s) => {
      await c.fetchByExternalId("tv", "1", ["de"]);
      return { ...s };
    });
    expect(callOrder[0]).toBe("pcjones");
    // pcjones returned a DE title, so Composite stops after the first hit.
    expect(callOrder).toEqual(["pcjones"]);
    expect(stats.pcjonesItems).toBe(0); // fetchByExternalId does not count toward stats
  });

  it("respects user order tvdb>pcjones>tmdb for DE", async () => {
    const c = buildComposite(["tvdb", "pcjones", "tmdb"]);
    await c.fetchByExternalId("tv", "1", ["de"]);
    expect(callOrder[0]).toBe("tvdb");
    expect(callOrder).toEqual(["tvdb"]);
  });

  it("skips pcjones for non-DE languages even if it leads the order", async () => {
    const c = buildComposite(["pcjones", "tvdb", "tmdb"]);
    await c.fetchByExternalId("tv", "1", ["sv"]);
    expect(callOrder).not.toContain("pcjones");
    expect(callOrder[0]).toBe("tvdb");
  });

  it("merges payloads when first provider misses a requested lang", async () => {
    // pcjones only provides DE; sv + en come from TVDB/TMDB.
    const c = buildComposite(["pcjones", "tvdb", "tmdb"]);
    const result = await c.fetchByExternalId("tv", "1", ["de", "sv", "en"]);
    expect(result).not.toBeNull();
    expect(result!.titlesByLang.de).toBe("PcjonesTitel");
    expect(result!.titlesByLang.sv).toBe("TvdbSv");
    expect(result!.titlesByLang.en).toBe("TvdbEn");
    expect(callOrder[0]).toBe("pcjones");
    expect(callOrder).toContain("tvdb");
  });

  it("fetchBulk records hits per provider in the order they contribute", async () => {
    const c = buildComposite(["tmdb", "tvdb", "pcjones"]);
    const stats: SyncStats = await withSyncStats(async (s) => {
      await c.fetchBulk("tv", ["1", "2"], ["de"]);
      return { ...s };
    });
    expect(stats.tmdbItems).toBe(2);
    // TMDB already returned DE for both ids, so tvdb/pcjones are skipped
    // (all wantedLangs covered).
    expect(stats.tvdbItems).toBe(0);
    expect(stats.pcjonesItems).toBe(0);
  });
});
