import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { AppState } from "@/server/state";
import type { CachedSearchItemInput } from "@/server/search-item";

function makeItem(over: Partial<CachedSearchItemInput> = {}): CachedSearchItemInput {
  return {
    id: "id-1",
    arrInstanceId: "inst-1",
    arrId: 1,
    externalId: "100",
    imdbId: null,
    title: "Realm of Ravens",
    expectedTitle: "Realm of Ravens",
    expectedAuthor: null,
    germanTitle: null,
    mediaType: "tv",
    year: null,
    titleSearchVariations: [],
    titleMatchVariations: ["Realm of Ravens"],
    authorMatchVariations: [],
    ...over,
  };
}

let state: AppState;

beforeEach(() => {
  state = new AppState();
});

describe("AppState ephemeral tier", () => {
  it("resolves an ephemeral item by external id", () => {
    state.indexEphemeral(makeItem());
    expect(state.getByExternalId("tv", "100")?.title).toBe("Realm of Ravens");
  });

  it("marks ephemeral items so callers can tell them apart", () => {
    state.indexEphemeral(makeItem());
    expect(state.getByExternalId("tv", "100")?.ephemeral).toBe(true);
  });

  it("resolves an ephemeral item by release title", () => {
    state.indexEphemeral(makeItem({ titleMatchVariations: ["Realm of Ravens"] }));
    expect(state.findByTitle("tv", "Realm of Ravens S01E01 Pilot")?.externalId).toBe("100");
  });

  it("resolves an ephemeral item by IMDb id", () => {
    state.indexEphemeral(makeItem({ externalId: "900", imdbId: "tt0000900" }));
    expect(state.getByImdbId("tt0000900")?.externalId).toBe("900");
  });

  it("lets a synced item win over an ephemeral one with the same key", () => {
    state.indexEphemeral(makeItem({ title: "From the provider" }));
    state.indexItem(makeItem({ title: "From the sync" }));
    expect(state.getByExternalId("tv", "100")?.title).toBe("From the sync");
    expect(state.getByExternalId("tv", "100")?.ephemeral).toBeUndefined();
  });

  it("re-indexing the same ephemeral key replaces rather than duplicates", () => {
    state.indexEphemeral(makeItem({ titleMatchVariations: ["Realm of Ravens"] }));
    state.indexEphemeral(makeItem({ titleMatchVariations: ["Reich der Raben"] }));
    // The stale variation must no longer match, or the prefix buckets leaked.
    expect(state.findByTitle("tv", "Realm of Ravens S01E01 Pilot")).toBeNull();
    expect(state.findByTitle("tv", "Reich der Raben S01E01 Pilot")?.externalId).toBe("100");
  });

  it("drops the oldest ephemeral entry once the cap is reached", () => {
    // The cap is 500; index one more than that and the first must be gone.
    for (let i = 0; i < 501; i++) {
      state.indexEphemeral(makeItem({ externalId: `e${i}`, titleMatchVariations: [`Title ${i}`] }));
    }
    expect(state.getByExternalId("tv", "e0")).toBeNull();
    expect(state.getByExternalId("tv", "e500")).not.toBeNull();
    // And the evicted item's variations must be gone from the prefix buckets.
    expect(state.findByTitle("tv", "Title 0 S01E01")).toBeNull();
  });

  it("keeps the sync tier untouched when an ephemeral entry is evicted", () => {
    state.indexItem(makeItem({ externalId: "keep", titleMatchVariations: ["Keep Me"] }));
    for (let i = 0; i < 501; i++) {
      state.indexEphemeral(makeItem({ externalId: `e${i}`, titleMatchVariations: [`Title ${i}`] }));
    }
    expect(state.getByExternalId("tv", "keep")).not.toBeNull();
    expect(state.findByTitle("tv", "Keep Me S01E01")?.externalId).toBe("keep");
  });
});
