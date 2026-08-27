import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockArr } = vi.hoisted(() => ({ mockArr: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: { arrInstance: mockArr } }));

const { mockBuild } = vi.hoisted(() => ({ mockBuild: vi.fn() }));
vi.mock("@/arr", () => ({ buildArrClient: mockBuild }));

const { mockLookupTmdbId } = vi.hoisted(() => ({ mockLookupTmdbId: vi.fn() }));
vi.mock("@/providers/imdb-lookup", () => ({ lookupTmdbIdByImdbId: mockLookupTmdbId }));

import {
  clearOnDemandCaches,
  ERROR_TTL_MS,
  NEGATIVE_TTL_MS,
  negativeTtlFor,
  resolveOnDemand,
} from "@/server/on-demand/resolve";

const DERIVED = {
  arrId: 7,
  externalId: "300",
  imdbId: null,
  title: "Realm of Ravens",
  expectedTitle: "Realm of Ravens",
  expectedAuthor: null,
  germanTitle: "Reich der Raben",
  mediaType: "tv" as const,
  aliases: null,
  hasUmlaut: false,
  year: 2019,
  titleSearchVariations: ["Reich der Raben"],
  titleMatchVariations: ["Reich der Raben", "Realm of Ravens"],
  authorMatchVariations: [],
};

const RAW = {
  arrId: 7,
  externalId: "300",
  imdbId: null,
  title: "Realm of Ravens",
  year: 2019,
  aliases: null,
  germanTitle: null,
  mediaType: "tv" as const,
  expectedAuthor: null,
};

const SONARR = {
  id: "i1",
  type: "sonarr",
  name: "S",
  host: "h",
  apiKey: "k",
  providerOrder: "pcjones",
};

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
}

function makeState(over: Record<string, unknown> = {}) {
  return {
    settings: { userAgent: "UA", tmdbApiKey: null },
    providerForOrder: vi.fn().mockReturnValue({ name: "stub" }),
    getByExternalId: vi.fn().mockReturnValue(null),
    indexEphemeral: vi.fn((item: unknown) => item),
    ...over,
  };
}

function deps(state: ReturnType<typeof makeState>, timeoutMs?: number) {
  return {
    state: state as never,
    logger: makeLogger() as never,
    ...(timeoutMs ? { timeoutMs } : {}),
  };
}

beforeEach(() => {
  mockArr.findMany.mockReset();
  mockBuild.mockReset();
  mockLookupTmdbId.mockReset();
  clearOnDemandCaches();
});

afterEach(() => {
  clearOnDemandCaches();
});

describe("resolveOnDemand", () => {
  it("resolves a tv title through the *Arr and indexes it ephemerally", async () => {
    mockArr.findMany.mockResolvedValue([SONARR]);
    mockBuild.mockReturnValue({
      fetchRawItemByExternalId: async () => RAW,
      deriveItems: async () => [DERIVED],
    });
    const state = makeState();

    const item = await resolveOnDemand(
      { mediaType: "tv", externalId: "300", imdbId: null },
      deps(state),
    );

    expect(item?.germanTitle).toBe("Reich der Raben");
    expect(state.indexEphemeral).toHaveBeenCalledOnce();
  });

  it("returns the already-indexed item without touching the *Arr", async () => {
    const state = makeState({
      getByExternalId: vi.fn().mockReturnValue({ externalId: "300", title: "Known" }),
    });

    const item = await resolveOnDemand(
      { mediaType: "tv", externalId: "300", imdbId: null },
      deps(state),
    );

    expect(item?.title).toBe("Known");
    expect(mockArr.findMany).not.toHaveBeenCalled();
  });

  it("returns null and remembers the miss so a second call makes no *Arr call", async () => {
    mockArr.findMany.mockResolvedValue([SONARR]);
    mockBuild.mockReturnValue({
      fetchRawItemByExternalId: async () => null,
      deriveItems: async () => [],
    });
    const state = makeState();
    const req = { mediaType: "tv" as const, externalId: "404", imdbId: null };

    expect(await resolveOnDemand(req, deps(state))).toBeNull();
    expect(await resolveOnDemand(req, deps(state))).toBeNull();

    expect(mockArr.findMany).toHaveBeenCalledOnce();
  });

  it("collapses two concurrent calls for the same id into one resolution", async () => {
    mockArr.findMany.mockResolvedValue([SONARR]);
    let calls = 0;
    mockBuild.mockReturnValue({
      fetchRawItemByExternalId: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return RAW;
      },
      deriveItems: async () => [DERIVED],
    });
    const state = makeState();
    const req = { mediaType: "tv" as const, externalId: "300", imdbId: null };
    const d = deps(state);

    const [a, b] = await Promise.all([resolveOnDemand(req, d), resolveOnDemand(req, d)]);

    expect(calls).toBe(1);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it("returns null when no enabled instance of the matching type exists", async () => {
    mockArr.findMany.mockResolvedValue([]);
    const state = makeState();

    expect(
      await resolveOnDemand({ mediaType: "tv", externalId: "300", imdbId: null }, deps(state)),
    ).toBeNull();
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("only asks instances of the type that can serve the media type", async () => {
    mockArr.findMany.mockResolvedValue([]);
    const state = makeState();

    await resolveOnDemand({ mediaType: "movie", externalId: "900", imdbId: null }, deps(state));

    expect(mockArr.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true, type: "radarr" } }),
    );
  });

  it("skips an instance whose api key is only the Prowlarr mask", async () => {
    mockArr.findMany.mockResolvedValue([{ ...SONARR, apiKey: "********" }]);
    const state = makeState();

    expect(
      await resolveOnDemand({ mediaType: "tv", externalId: "300", imdbId: null }, deps(state)),
    ).toBeNull();
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("falls through to the next instance when the first does not know the id", async () => {
    mockArr.findMany.mockResolvedValue([SONARR, { ...SONARR, id: "i2", name: "S2" }]);
    const hosts: string[] = [];
    mockBuild.mockImplementation((opts: { instanceName: string }) => ({
      fetchRawItemByExternalId: async () => {
        hosts.push(opts.instanceName);
        return opts.instanceName === "S2" ? RAW : null;
      },
      deriveItems: async () => [DERIVED],
    }));
    const state = makeState();

    const item = await resolveOnDemand(
      { mediaType: "tv", externalId: "300", imdbId: null },
      deps(state),
    );

    expect(hosts).toEqual(["S", "S2"]);
    expect(item).not.toBeNull();
  });

  it("maps an imdbid to a tmdbid before asking the *Arr", async () => {
    mockLookupTmdbId.mockResolvedValue("900");
    mockArr.findMany.mockResolvedValue([
      { id: "i1", type: "radarr", name: "R", host: "h", apiKey: "k", providerOrder: "tmdb" },
    ]);
    const asked: string[] = [];
    mockBuild.mockReturnValue({
      fetchRawItemByExternalId: async (id: string) => {
        asked.push(id);
        return { ...RAW, externalId: "900", mediaType: "movie" as const };
      },
      deriveItems: async () => [{ ...DERIVED, externalId: "900", mediaType: "movie" as const }],
    });
    const state = makeState({ settings: { userAgent: "UA", tmdbApiKey: "k".repeat(32) } });

    const item = await resolveOnDemand(
      { mediaType: "movie", externalId: null, imdbId: "tt0000900" },
      deps(state),
    );

    expect(asked).toEqual(["900"]);
    expect(item?.externalId).toBe("900");
  });

  it("returns null when an imdbid cannot be mapped", async () => {
    mockLookupTmdbId.mockResolvedValue(null);
    const state = makeState();

    expect(
      await resolveOnDemand(
        { mediaType: "movie", externalId: null, imdbId: "tt0000900" },
        deps(state),
      ),
    ).toBeNull();
    expect(mockArr.findMany).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the *Arr call blows up", async () => {
    mockArr.findMany.mockResolvedValue([SONARR]);
    mockBuild.mockReturnValue({
      fetchRawItemByExternalId: async () => {
        throw new Error("connection refused");
      },
      deriveItems: async () => [],
    });
    const state = makeState();

    expect(
      await resolveOnDemand({ mediaType: "tv", externalId: "300", imdbId: null }, deps(state)),
    ).toBeNull();
  });

  it("gives up on the time budget and returns null", async () => {
    mockArr.findMany.mockResolvedValue([SONARR]);
    mockBuild.mockReturnValue({
      fetchRawItemByExternalId: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return RAW;
      },
      deriveItems: async () => [DERIVED],
    });
    const state = makeState();

    const item = await resolveOnDemand(
      { mediaType: "tv", externalId: "300", imdbId: null },
      deps(state, 20),
    );

    expect(item).toBeNull();
  });
});

describe("negativeTtlFor", () => {
  it("gives a genuine miss the long window", () => {
    expect(negativeTtlFor("empty")).toBe(NEGATIVE_TTL_MS);
    expect(NEGATIVE_TTL_MS).toBe(30 * 60 * 1000);
  });

  it("gives an error the short window, so a restarting *Arr is retried soon", () => {
    expect(negativeTtlFor("error")).toBe(ERROR_TTL_MS);
    expect(ERROR_TTL_MS).toBe(60 * 1000);
  });

  it("treats an exhausted budget like an error, not like a miss", () => {
    expect(negativeTtlFor("timeout")).toBe(ERROR_TTL_MS);
  });

  it("keeps the error window well below the miss window", () => {
    expect(ERROR_TTL_MS).toBeLessThan(NEGATIVE_TTL_MS);
  });
});
