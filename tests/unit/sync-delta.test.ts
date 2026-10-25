import { describe, expect, it } from "vitest";
import { planDelta, type StoredDeltaKey } from "@/server/sync/delta";
import type { RawArrItem } from "@/arr/raw-item";

function raw(over: Partial<RawArrItem> = {}): RawArrItem {
  return {
    arrId: 1,
    externalId: "100",
    externalIdAliases: null,
    imdbId: null,
    title: "Realm of Ravens",
    year: 2019,
    aliases: null,
    germanTitle: null,
    mediaType: "tv",
    expectedAuthor: null,
    ...over,
  };
}

function stored(over: Partial<StoredDeltaKey> = {}): StoredDeltaKey {
  return {
    externalId: "100",
    title: "Realm of Ravens",
    year: 2019,
    externalIdAliases: null,
    ...over,
  };
}

/** A Listenarr-shaped audiobook: the series feeds only the alias list. */
function book(over: Partial<RawArrItem> = {}): RawArrItem {
  return raw({
    externalId: "900",
    title: "Sunken Bells",
    year: 2026,
    mediaType: "book",
    expectedAuthor: "Marla Ostrand",
    ...over,
  });
}

function storedBook(over: Partial<StoredDeltaKey> = {}): StoredDeltaKey {
  return stored({ externalId: "900", title: "Sunken Bells", year: 2026, ...over });
}

describe("planDelta", () => {
  it("reports nothing to do when both sides agree", () => {
    const plan = planDelta([raw()], [stored()]);
    expect(plan.changed).toEqual([]);
    expect(plan.removedExternalIds).toEqual([]);
    expect(plan.isEmpty).toBe(true);
  });

  it("treats an unknown externalId as changed", () => {
    const plan = planDelta([raw(), raw({ externalId: "200", title: "New Show" })], [stored()]);
    expect(plan.changed.map((c) => c.externalId)).toEqual(["200"]);
    expect(plan.removedExternalIds).toEqual([]);
    expect(plan.isEmpty).toBe(false);
  });

  it("reports a stored row the *Arr no longer lists as removed", () => {
    const plan = planDelta([], [stored(), stored({ externalId: "200" })]);
    expect(plan.changed).toEqual([]);
    expect(plan.removedExternalIds.sort()).toEqual(["100", "200"]);
    expect(plan.isEmpty).toBe(false);
  });

  it("detects an *Arr-side title change", () => {
    const plan = planDelta([raw({ title: "Reich der Raben" })], [stored()]);
    expect(plan.changed.map((c) => c.title)).toEqual(["Reich der Raben"]);
  });

  it("detects an *Arr-side year change", () => {
    const plan = planDelta([raw({ year: 2020 })], [stored({ year: 2019 })]);
    expect(plan.changed).toHaveLength(1);
  });

  it("treats a year appearing or disappearing as a change", () => {
    expect(planDelta([raw({ year: null })], [stored({ year: 2019 })]).changed).toHaveLength(1);
    expect(planDelta([raw({ year: 2019 })], [stored({ year: null })]).changed).toHaveLength(1);
  });

  it("keeps the last raw entry when the *Arr reports one externalId twice", () => {
    // persistItems dedupes too, but planDelta must not emit the same
    // externalId twice or the caller would upsert it in one transaction twice.
    const plan = planDelta([raw({ title: "First" }), raw({ title: "Second" })], []);
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]?.title).toBe("Second");
  });

  it("detects a Listenarr series being added to a book", () => {
    // The series feeds neither externalId nor title nor year, only the alias.
    const plan = planDelta(
      [book({ externalIdAliases: ["Sunken Bells Marla Ostrand Tidewater Chronicles"] })],
      [storedBook({ externalIdAliases: null })],
    );
    expect(plan.changed.map((c) => c.externalId)).toEqual(["900"]);
    expect(plan.isEmpty).toBe(false);
  });

  it("detects a Listenarr series being removed from a book", () => {
    const plan = planDelta(
      [book({ externalIdAliases: null })],
      [storedBook({ externalIdAliases: '["Sunken Bells Marla Ostrand Tidewater Chronicles"]' })],
    );
    expect(plan.changed.map((c) => c.externalId)).toEqual(["900"]);
    expect(plan.isEmpty).toBe(false);
  });

  it("leaves an unchanged alias alone so a settled Listenarr library stays cheap", () => {
    const plan = planDelta(
      [book({ externalIdAliases: ["Sunken Bells Marla Ostrand Tidewater Chronicles"] })],
      [storedBook({ externalIdAliases: '["Sunken Bells Marla Ostrand Tidewater Chronicles"]' })],
    );
    expect(plan.changed).toEqual([]);
    expect(plan.isEmpty).toBe(true);
  });

  it("ignores the alias column for the *Arrs that never set one", () => {
    const plan = planDelta([raw()], [stored()]);
    expect(plan.changed).toEqual([]);
    expect(plan.isEmpty).toBe(true);
  });

  it("handles both sides empty", () => {
    const plan = planDelta([], []);
    expect(plan.isEmpty).toBe(true);
  });
});
