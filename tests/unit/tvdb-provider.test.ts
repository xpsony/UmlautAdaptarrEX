import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("undici", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock("@/providers/rate-limit", () => ({
  HostRateLimiter: class {
    async wait(): Promise<void> {
      // no-op for tests
    }
  },
}));

import { TvdbProvider } from "@/providers/tvdb";

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  requestMock.mockReset();
});

describe("TvdbProvider construction", () => {
  it("requires an api key", () => {
    expect(() => new TvdbProvider({ apiKey: "", userAgent: "UA" })).toThrow(/requires an API key/);
  });

  it("declares wildcard supportedLanguages", () => {
    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    expect(p.supportedLanguages()).toEqual(["*"]);
  });

  it("name is 'tvdb'", () => {
    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    expect(p.name).toBe("tvdb");
  });
});

describe("TvdbProvider.fetchByExternalId early returns", () => {
  function provider(): TvdbProvider {
    return new TvdbProvider({ apiKey: "k", userAgent: "UA" });
  }

  it("returns null for unsupported media types", async () => {
    expect(await provider().fetchByExternalId("audio", "1")).toBeNull();
    expect(await provider().fetchByExternalId("book", "1")).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("returns null for non-numeric tv ids", async () => {
    expect(await provider().fetchByExternalId("tv", "not-a-number")).toBeNull();
    expect(await provider().fetchByExternalId("tv", "0")).toBeNull();
  });
});

describe("TvdbProvider.fetchBulk", () => {
  function provider(): TvdbProvider {
    return new TvdbProvider({ apiKey: "k", userAgent: "UA" });
  }

  it("returns an empty map for empty ids and unsupported types", async () => {
    expect((await provider().fetchBulk("tv", [])).size).toBe(0);
    expect((await provider().fetchBulk("audio", ["1"])).size).toBe(0);
  });
});

describe("TvdbProvider.fetchByTitle", () => {
  it("is a no-op (TVDB title search not implemented)", async () => {
    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    // The class declares a zero-arg fetchByTitle stub on purpose; the
    // wider TitleProvider interface that callers go through accepts the
    // (type, title) signature, so we cast to assert the runtime contract.
    const titleFetch = p.fetchByTitle as unknown as (
      type: string,
      title: string,
    ) => Promise<unknown>;
    expect(await titleFetch.call(p, "tv", "X")).toBeNull();
  });
});

// ── Original-language fallback ───────────────────────────────────────────────
//
// Regression cover for the reported "German name never reaches the indexer"
// case: a German production whose German title lives in the extended record's
// `name` (originalLanguage = "deu") while only an `eng` name translation
// exists. `/translations/deu` answers 404, so step 1 finds nothing and the
// German title has to come out of `/extended`.

function jsonResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    body: {
      json: async () => data,
      text: async () => JSON.stringify(data),
    },
  };
}

function loginResponse() {
  return jsonResponse({ status: "success", data: { token: "JWT" } });
}

describe("TvdbProvider extended-record title fallback", () => {
  it("uses the record's primary name when originalLanguage matches the wanted lang", async () => {
    requestMock
      .mockResolvedValueOnce(loginResponse())
      // /series/1/translations/deu → 404: no German translation record
      .mockResolvedValueOnce(jsonResponse({ status: "failure" }, 404))
      // /series/1/extended → German title sits in `name`
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: {
            id: 1,
            name: "Kai & Nora machen Urlaub",
            originalLanguage: "deu",
            aliases: [],
            translations: {
              nameTranslations: [{ name: "Kai & Nora go on holiday", language: "eng" }],
            },
          },
        }),
      );

    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    const payload = await p.fetchByExternalId("tv", "1", ["de"]);
    expect(payload?.germanTitle).toBe("Kai & Nora machen Urlaub");
    expect(payload?.titlesByLang["de"]).toBe("Kai & Nora machen Urlaub");
  });

  it("picks up a nameTranslations entry the translations endpoint did not return", async () => {
    requestMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse({ status: "failure" }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: {
            id: 2,
            name: "Some English Show",
            originalLanguage: "eng",
            translations: {
              nameTranslations: [
                { name: "Deutscher Titel", language: "deu" },
                { name: "Some English Show", language: "eng" },
              ],
            },
          },
        }),
      );

    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    const payload = await p.fetchByExternalId("tv", "2", ["de"]);
    expect(payload?.titlesByLang["de"]).toBe("Deutscher Titel");
  });

  it("files an isAlias nameTranslations entry as an alias, not as the title", async () => {
    requestMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse({ status: "failure" }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: {
            id: 3,
            name: "Original",
            originalLanguage: "eng",
            translations: {
              nameTranslations: [
                { name: "Alternative Schreibweise", language: "deu", isAlias: true },
              ],
            },
          },
        }),
      );

    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    const payload = await p.fetchByExternalId("tv", "3", ["de"]);
    expect(payload?.titlesByLang["de"]).toBeUndefined();
    expect(payload?.aliases).toEqual(["Alternative Schreibweise"]);
  });

  it("does not adopt the primary name when originalLanguage is a different language", async () => {
    requestMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(jsonResponse({ status: "failure" }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          data: {
            id: 4,
            name: "An English Only Show",
            originalLanguage: "eng",
            aliases: [],
            translations: { nameTranslations: [] },
          },
        }),
      );

    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    // Nothing usable at all → provider reports a miss instead of filing the
    // English name under "de".
    expect(await p.fetchByExternalId("tv", "4", ["de"])).toBeNull();
  });

  it("skips the extended call entirely once titles and aliases are both resolved", async () => {
    requestMock.mockResolvedValueOnce(loginResponse()).mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        data: { name: "Deutscher Titel", language: "deu", aliases: ["Alias DE"] },
      }),
    );

    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    const payload = await p.fetchByExternalId("tv", "5", ["de"]);
    expect(payload?.titlesByLang["de"]).toBe("Deutscher Titel");
    // login + translations only - no /extended roundtrip.
    expect(requestMock.mock.calls).toHaveLength(2);
  });
});

// ── Per-language request cost ────────────────────────────────────────────────
//
// Backs the Settings/Setup hint that every additional language plugin costs
// additional lookups: TVDB has no bulk translations endpoint, so
// fetchByExternalId issues one `/translations/{lang3}` call PER requested
// language, per item, on every sync. (TMDB by contrast returns all languages
// in a single call, so it does not scale with the plugin count.)
describe("TvdbProvider per-language request cost", () => {
  it("issues one translations request per requested language", async () => {
    requestMock.mockResolvedValueOnce(loginResponse());
    for (const name of ["Deutscher Titel", "Svensk titel", "Titre français"]) {
      requestMock.mockResolvedValueOnce(
        jsonResponse({ status: "success", data: { name, aliases: ["x"] } }),
      );
    }

    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    await p.fetchByExternalId("tv", "10", ["de", "sv", "fr"]);

    const translationCalls = requestMock.mock.calls.filter(([url]) =>
      String(url).includes("/translations/"),
    );
    expect(translationCalls).toHaveLength(3);
    expect(String(translationCalls[0]?.[0])).toContain("/translations/deu");
    expect(String(translationCalls[1]?.[0])).toContain("/translations/swe");
    expect(String(translationCalls[2]?.[0])).toContain("/translations/fra");
  });

  it("issues a single translations request when only German is requested", async () => {
    requestMock.mockResolvedValueOnce(loginResponse()).mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        data: { name: "Deutscher Titel", aliases: ["x"] },
      }),
    );

    const p = new TvdbProvider({ apiKey: "k", userAgent: "UA" });
    await p.fetchByExternalId("tv", "11", ["de"]);

    expect(
      requestMock.mock.calls.filter(([url]) => String(url).includes("/translations/")),
    ).toHaveLength(1);
  });
});
