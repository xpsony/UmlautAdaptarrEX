import { describe, expect, it } from "vitest";
import {
  applyPatchToRaw,
  computePatchPlan,
  flipScheme,
  getBaseUrlValue,
  isPatchableUrl,
  toIndexerView,
  type RawProwlarrIndexer,
} from "@/arr/prowlarr/indexers";

function raw(over: Partial<RawProwlarrIndexer>): RawProwlarrIndexer {
  return {
    id: 1,
    name: "Example",
    enable: true,
    protocol: "torrent",
    fields: [{ name: "baseUrl", value: "https://example.test/" }],
    tags: [],
    ...over,
  };
}

describe("flipScheme", () => {
  it("flips https to http preserving host/path", () => {
    expect(flipScheme("https://a.test/api?x=1", "http")).toBe("http://a.test/api?x=1");
  });
  it("flips http to https", () => {
    expect(flipScheme("http://a.test/", "https")).toBe("https://a.test/");
  });
  it("is case-insensitive on the existing scheme", () => {
    expect(flipScheme("HTTPS://a.test", "http")).toBe("http://a.test");
  });
  it("leaves scheme-less values untouched", () => {
    expect(flipScheme("a.test/path", "http")).toBe("a.test/path");
  });
});

describe("getBaseUrlValue / isPatchableUrl", () => {
  it("reads the baseUrl field value", () => {
    expect(getBaseUrlValue(raw({}))).toBe("https://example.test/");
  });
  it("returns null when there is no baseUrl field", () => {
    expect(getBaseUrlValue(raw({ fields: [{ name: "apiKey", value: "x" }] }))).toBeNull();
  });
  it("treats a real http(s) URL as patchable", () => {
    expect(isPatchableUrl("https://a.test")).toBe(true);
    expect(isPatchableUrl("ftp://a.test")).toBe(false);
    expect(isPatchableUrl(null)).toBe(false);
  });
});

describe("toIndexerView", () => {
  it("marks patched when the tag id is present", () => {
    const v = toIndexerView(raw({ tags: [7] }), 7);
    expect(v.isPatched).toBe(true);
    expect(v.patchable).toBe(true);
    expect(v.currentBaseUrl).toBe("https://example.test/");
  });
  it("is never patched when the tag id is null (tag not created yet)", () => {
    expect(toIndexerView(raw({ tags: [7] }), null).isPatched).toBe(false);
  });
  it("flags non-patchable indexers with a reason", () => {
    const v = toIndexerView(raw({ fields: [] }), 7);
    expect(v.patchable).toBe(false);
    expect(v.reason).toBe("no_base_url");
  });
});

describe("computePatchPlan", () => {
  const tagId = 7;
  it("plans patch for a selected, unpatched, patchable indexer", () => {
    const plan = computePatchPlan([raw({ id: 1, tags: [] })], tagId, new Set([1]));
    expect(plan[0]!.action).toBe("patch");
  });
  it("plans unpatch for a deselected, patched indexer", () => {
    const plan = computePatchPlan(
      [
        raw({
          id: 1,
          tags: [7],
          fields: [{ name: "baseUrl", value: "http://e.test" }],
        }),
      ],
      tagId,
      new Set(),
    );
    expect(plan[0]!.action).toBe("unpatch");
  });
  it("plans unchanged for an already-patched, still-selected indexer", () => {
    const plan = computePatchPlan([raw({ id: 1, tags: [7] })], tagId, new Set([1]));
    expect(plan[0]!.action).toBe("unchanged");
  });
  it("plans skip for a selected but non-patchable indexer", () => {
    const plan = computePatchPlan([raw({ id: 1, fields: [] })], tagId, new Set([1]));
    expect(plan[0]!.action).toBe("skip");
  });
});

describe("applyPatchToRaw", () => {
  it("adds the tag and flips baseUrl to http when patching", () => {
    const out = applyPatchToRaw(raw({ id: 1, tags: [3] }), 7, true);
    expect(out.tags).toEqual([3, 7]);
    expect((out.fields ?? []).find((f) => f.name === "baseUrl")?.value).toBe(
      "http://example.test/",
    );
  });
  it("removes the tag and flips baseUrl to https when un-patching", () => {
    const out = applyPatchToRaw(
      raw({
        id: 1,
        tags: [3, 7],
        fields: [{ name: "baseUrl", value: "http://example.test/" }],
      }),
      7,
      false,
    );
    expect(out.tags).toEqual([3]);
    expect((out.fields ?? []).find((f) => f.name === "baseUrl")?.value).toBe(
      "https://example.test/",
    );
  });
  it("does not duplicate an already-present tag", () => {
    const out = applyPatchToRaw(raw({ id: 1, tags: [7] }), 7, true);
    expect(out.tags).toEqual([7]);
  });
});
