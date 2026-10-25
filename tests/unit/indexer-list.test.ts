import { describe, expect, it } from "vitest";
import { mergeIndexerList } from "@/server/indexers/list";

describe("mergeIndexerList", () => {
  const at = new Date("2026-10-20T10:00:00Z");
  const custom = {
    tv: false,
    movie: false,
    audio: true,
    book: true,
    tvMax: 1,
    movieMax: 0,
    audioMax: 4,
    bookMax: 2,
  };

  it("unions history, Prowlarr and rows by lower-cased host", () => {
    const list = mergeIndexerList(
      [{ domain: "Idx-One.test", lastSearchAt: at }],
      [
        { host: "idx-one.test", name: "Indexer One" },
        { host: "idx-two.test", name: "Indexer Two" },
      ],
      [{ host: "idx-three.test", ...custom }],
    );
    // Sorted by name, unnamed hosts by host: "idx-three.test" < "Indexer One".
    expect(list).toEqual([
      {
        host: "idx-three.test",
        name: null,
        lastSearchAt: null,
        custom,
      },
      { host: "idx-one.test", name: "Indexer One", lastSearchAt: at.toISOString(), custom: null },
      { host: "idx-two.test", name: "Indexer Two", lastSearchAt: null, custom: null },
    ]);
  });

  it("sorts by name, falling back to the host", () => {
    const list = mergeIndexerList(
      [{ domain: "b.test", lastSearchAt: at }],
      [{ host: "z.test", name: "Alpha" }],
      [],
    );
    expect(list.map((e) => e.host)).toEqual(["z.test", "b.test"]);
  });

  it("keeps the latest search when two history spellings of one host differ in case", () => {
    const later = new Date("2026-10-21T10:00:00Z");
    const list = mergeIndexerList(
      [
        { domain: "idx.test", lastSearchAt: later },
        { domain: "IDX.test", lastSearchAt: at },
      ],
      [],
      [],
    );
    expect(list).toEqual([
      { host: "idx.test", name: null, lastSearchAt: later.toISOString(), custom: null },
    ]);
  });
});
