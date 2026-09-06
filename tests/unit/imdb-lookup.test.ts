import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMock } = vi.hoisted(() => ({ findMock: vi.fn() }));

vi.mock("moviedb-promise", () => ({
  MovieDb: class {
    find = findMock;
  },
}));

import { clearImdbMappingCache, lookupTmdbIdByImdbId } from "@/providers/imdb-lookup";

const KEY = "k".repeat(32);

beforeEach(() => {
  findMock.mockReset();
  clearImdbMappingCache();
});

describe("lookupTmdbIdByImdbId", () => {
  it("returns null without an API key and never calls TMDB", async () => {
    expect(await lookupTmdbIdByImdbId(null, "tt0000900")).toBeNull();
    expect(findMock).not.toHaveBeenCalled();
  });

  it("rejects a TMDB v4 read-access token without calling TMDB", async () => {
    expect(await lookupTmdbIdByImdbId("eyJhbGciOi.abc.def", "tt0000900")).toBeNull();
    expect(findMock).not.toHaveBeenCalled();
  });

  it("returns null for an unusable id without calling TMDB", async () => {
    expect(await lookupTmdbIdByImdbId(KEY, "not-an-id")).toBeNull();
    expect(findMock).not.toHaveBeenCalled();
  });

  it("normalises a numeric id before asking TMDB", async () => {
    findMock.mockResolvedValue({ movie_results: [{ id: 900 }], tv_results: [] });
    expect(await lookupTmdbIdByImdbId(KEY, "0000900")).toBe("900");
    expect(findMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tt0000900", external_source: "imdb_id" }),
      expect.anything(),
    );
  });

  it("returns null when TMDB knows the id but has no movie for it", async () => {
    findMock.mockResolvedValue({ movie_results: [], tv_results: [{ id: 5 }] });
    expect(await lookupTmdbIdByImdbId(KEY, "tt0000900")).toBeNull();
  });

  it("swallows a TMDB failure and returns null", async () => {
    findMock.mockRejectedValue(new Error("429"));
    expect(await lookupTmdbIdByImdbId(KEY, "tt0000900")).toBeNull();
  });

  it("caches a resolved mapping so a repeat lookup makes no second call", async () => {
    findMock.mockResolvedValue({ movie_results: [{ id: 901 }], tv_results: [] });
    expect(await lookupTmdbIdByImdbId(KEY, "tt0000901")).toBe("901");
    expect(await lookupTmdbIdByImdbId(KEY, "tt0000901")).toBe("901");
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a miss, so a later TMDB recovery is picked up", async () => {
    findMock.mockResolvedValueOnce({ movie_results: [], tv_results: [] });
    findMock.mockResolvedValueOnce({ movie_results: [{ id: 902 }], tv_results: [] });
    expect(await lookupTmdbIdByImdbId(KEY, "tt0000902")).toBeNull();
    expect(await lookupTmdbIdByImdbId(KEY, "tt0000902")).toBe("902");
  });
});
