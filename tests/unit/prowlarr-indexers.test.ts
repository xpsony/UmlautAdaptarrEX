import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Dispatcher } from "undici";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import {
  applyPatchToRaw,
  computePatchPlan,
  detachTagIds,
  fetchProwlarrIndexers,
  findOtherProxies,
  flipScheme,
  getBaseUrlValue,
  getImplementation,
  isCorrectableImplementation,
  isPatchableUrl,
  patchSkipReason,
  reconcileIndexerPatches,
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
  it("carries the implementation through for the dialog tooltip", () => {
    expect(toIndexerView(raw({ implementation: "Torznab" }), 7).implementation).toBe("Torznab");
    expect(toIndexerView(raw({}), 7).implementation).toBeNull();
  });
});

describe("implementation gate", () => {
  it("reads implementation, falling back to implementationName", () => {
    expect(getImplementation(raw({ implementation: "Newznab" }))).toBe("Newznab");
    expect(getImplementation(raw({ implementationName: "Torznab" }))).toBe("Torznab");
    expect(getImplementation(raw({ implementation: "  " }))).toBeNull();
  });

  it("accepts Newznab and Torznab, whatever the casing", () => {
    expect(isCorrectableImplementation(raw({ implementation: "Newznab" }))).toBe(true);
    expect(isCorrectableImplementation(raw({ implementation: "torznab" }))).toBe(true);
  });

  it("rejects an implementation that speaks the tracker's own API", () => {
    // A definition-driven tracker answers its own JSON endpoint, which neither
    // the search fan-out nor the response rewriting can read - and the legacy
    // route has nothing to answer a request without a Newznab `t` parameter.
    const v = toIndexerView(raw({ name: "Rivet Vault", implementation: "Cardigann" }), 7);
    expect(v.patchable).toBe(false);
    expect(v.reason).toBe("unsupported_api");
    expect(v.implementation).toBe("Cardigann");
  });

  it("fails open when Prowlarr reports no implementation at all", () => {
    // An older Prowlarr that omits the field must not grey out every indexer.
    expect(isCorrectableImplementation(raw({}))).toBe(true);
    expect(patchSkipReason(raw({}))).toBeNull();
  });

  it("reports the missing base URL first when both are wrong", () => {
    expect(patchSkipReason(raw({ fields: [], implementation: "Cardigann" }))).toBe("no_base_url");
  });
});

describe("computePatchPlan", () => {
  const tagId = 7;
  it("skips a selected indexer whose API cannot be corrected", () => {
    const plan = computePatchPlan(
      [raw({ id: 1, name: "Rivet Vault", implementation: "Cardigann", tags: [] })],
      tagId,
      new Set([1]),
    );
    expect(plan[0]!.action).toBe("skip");
  });

  it("still un-patches such an indexer when it carries the tag already", () => {
    // The reverse direction must stay open: an indexer that was tagged before
    // this gate existed has to be removable, tag and scheme both.
    const plan = computePatchPlan(
      [raw({ id: 1, name: "Rivet Vault", implementation: "Cardigann", tags: [tagId] })],
      tagId,
      new Set(),
    );
    expect(plan[0]!.action).toBe("unpatch");
    const reverted = applyPatchToRaw(plan[0]!.raw, tagId, false);
    expect(reverted.tags).toEqual([]);
    expect(getBaseUrlValue(reverted)).toBe("https://example.test/");
  });

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

describe("findOtherProxies", () => {
  const labels = new Map([
    [3, "umlautadaptarr"],
    [7, "umlautadaptarrex"],
    [9, "flare"],
  ]);

  it("reports a foreign proxy that shares a tag, with the shared tag labels", () => {
    const proxies = [{ id: 1, name: "UmlautAdaptarr", implementation: "Http", tags: [3, 4] }];
    expect(findOtherProxies(raw({ tags: [3, 7] }), proxies, labels)).toEqual([
      { name: "UmlautAdaptarr", tags: ["umlautadaptarr"] },
    ]);
  });
  it("ignores our own proxy, whatever the casing of its name", () => {
    const proxies = [{ id: 2, name: "umlautadaptarrEX", implementation: "Http", tags: [7] }];
    expect(findOtherProxies(raw({ tags: [7] }), proxies, labels)).toEqual([]);
  });
  it("ignores FlareSolverr, which Prowlarr stacks instead of choosing between", () => {
    const proxies = [{ id: 3, name: "Flare", implementation: "FlareSolverr", tags: [9] }];
    expect(findOtherProxies(raw({ tags: [9] }), proxies, labels)).toEqual([]);
  });
  it("ignores proxies without a shared tag and untagged indexers", () => {
    const proxies = [{ id: 1, name: "Socks", implementation: "Socks5", tags: [3] }];
    expect(findOtherProxies(raw({ tags: [7] }), proxies, labels)).toEqual([]);
    expect(findOtherProxies(raw({ tags: [] }), proxies, labels)).toEqual([]);
  });
  it("falls back to the tag id when the label is unknown", () => {
    const proxies = [{ id: 1, name: "Old", implementation: "Http", tags: [42] }];
    expect(findOtherProxies(raw({ tags: [42] }), proxies, labels)).toEqual([
      { name: "Old", tags: ["#42"] },
    ]);
  });
});

describe("Prowlarr indexer calls", () => {
  const HOST = "http://prowlarr:9696";
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
  });

  it("lists indexers with the foreign proxies they are also attached to", async () => {
    const pool = mockAgent.get(HOST);
    pool.intercept({ path: "/api/v1/tag", method: "GET" }).reply(200, [
      { id: 3, label: "umlautadaptarr" },
      { id: 7, label: "umlautadaptarrex" },
    ]);
    pool.intercept({ path: "/api/v1/indexerproxy", method: "GET" }).reply(200, [
      { id: 1, name: "UmlautAdaptarr", implementation: "Http", tags: [3] },
      { id: 2, name: "UmlautAdaptarrEX", implementation: "Http", tags: [7] },
    ]);
    pool
      .intercept({ path: "/api/v1/indexer", method: "GET" })
      .reply(200, [raw({ id: 1, tags: [3, 7] }), raw({ id: 2, tags: [7] })]);

    const res = await fetchProwlarrIndexers(HOST, "key-12345678", "test");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.indexers.map((i) => [i.id, i.isPatched, i.otherProxies])).toEqual([
      [1, true, [{ name: "UmlautAdaptarr", tags: ["umlautadaptarr"] }]],
      [2, true, []],
    ]);
  });

  it("still lists indexers when the proxy list cannot be read", async () => {
    const pool = mockAgent.get(HOST);
    pool.intercept({ path: "/api/v1/tag", method: "GET" }).reply(200, []);
    pool.intercept({ path: "/api/v1/indexerproxy", method: "GET" }).reply(500, "boom");
    pool.intercept({ path: "/api/v1/indexer", method: "GET" }).reply(200, [raw({ id: 1 })]);

    const res = await fetchProwlarrIndexers(HOST, "key-12345678", "test");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.indexers[0]?.otherProxies).toEqual([]);
  });

  it("saves with forceSave so a failing indexer test (e.g. daily limit) does not block it", async () => {
    const pool = mockAgent.get(HOST);
    pool
      .intercept({ path: "/api/v1/tag", method: "GET" })
      .reply(200, [{ id: 7, label: "umlautadaptarrex" }]);
    pool.intercept({ path: "/api/v1/indexer", method: "GET" }).reply(200, [raw({ id: 5 })]);
    let putBody: RawProwlarrIndexer | undefined;
    pool
      .intercept({ path: "/api/v1/indexer/5?forceSave=true", method: "PUT" })
      .reply(202, (opts) => {
        putBody = JSON.parse(String(opts.body)) as RawProwlarrIndexer;
        return putBody;
      });

    const res = await reconcileIndexerPatches(HOST, "key-12345678", "test", {
      selectedIds: [5],
      detachIds: [],
    });
    expect(res).toEqual({ ok: true, results: [{ id: 5, name: "Example", action: "patched" }] });
    expect(putBody?.tags).toEqual([7]);
  });
});

describe("detachTagIds / detach plan", () => {
  const proxies = [
    { id: 1, name: "UmlautAdaptarr", implementation: "Http", tags: [3] },
    { id: 2, name: "UmlautAdaptarrEX", implementation: "Http", tags: [7] },
    { id: 3, name: "Flare", implementation: "FlareSolverr", tags: [9] },
    { id: 4, name: "Shared", implementation: "Socks5", tags: [9, 11] },
  ];

  it("removes the tags of competing proxies only", () => {
    expect(
      detachTagIds(raw({ tags: [3, 7, 9, 11, 20] }), proxies, 7).sort((a, b) => a - b),
    ).toEqual([3, 11]);
  });
  it("never removes our own tag, even when another proxy carries it too", () => {
    const withOurs = [{ id: 5, name: "Old", implementation: "Http", tags: [7] }];
    expect(detachTagIds(raw({ tags: [7] }), withOurs, 7)).toEqual([]);
  });
  it("detaches only indexers that end up patched", () => {
    const indexers = [
      raw({ id: 1, tags: [3] }), // selected, gets patched
      raw({ id: 2, tags: [3, 7] }), // selected, already patched
      raw({ id: 3, tags: [3] }), // not selected: stays on the old proxy
      raw({ id: 4, tags: [3], fields: [] }), // selected but not patchable
    ];
    const plan = computePatchPlan(indexers, 7, new Set([1, 2, 4]), new Set([1, 2, 3, 4]), proxies);
    expect(plan.map((p) => [p.raw.id, p.action, p.detachTags])).toEqual([
      [1, "patch", [3]],
      [2, "unchanged", [3]],
      [3, "unchanged", []],
      [4, "skip", []],
    ]);
  });
  it("leaves every tag alone without an explicit detach", () => {
    const plan = computePatchPlan([raw({ id: 1, tags: [3] })], 7, new Set([1]), new Set(), proxies);
    expect(plan[0]?.detachTags).toEqual([]);
  });
  it("applyPatchToRaw drops the detached tags together with the patch", () => {
    expect(applyPatchToRaw(raw({ tags: [3, 5] }), 7, true, [3]).tags).toEqual([5, 7]);
  });
});

describe("reconcileIndexerPatches with detach", () => {
  const HOST = "http://prowlarr:9696";
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
  });

  it("takes the old proxy's tag off an already patched indexer without flipping the scheme", async () => {
    const pool = mockAgent.get(HOST);
    pool
      .intercept({ path: "/api/v1/tag", method: "GET" })
      .reply(200, [{ id: 7, label: "umlautadaptarrex" }]);
    pool
      .intercept({ path: "/api/v1/indexerproxy", method: "GET" })
      .reply(200, [{ id: 1, name: "UmlautAdaptarr", implementation: "Http", tags: [3] }]);
    pool.intercept({ path: "/api/v1/indexer", method: "GET" }).reply(200, [
      raw({
        id: 5,
        tags: [3, 7],
        fields: [{ name: "baseUrl", value: "http://example.test/" }],
      }),
    ]);
    let putBody: RawProwlarrIndexer | undefined;
    pool
      .intercept({ path: "/api/v1/indexer/5?forceSave=true", method: "PUT" })
      .reply(202, (opts) => {
        putBody = JSON.parse(String(opts.body)) as RawProwlarrIndexer;
        return putBody;
      });

    const res = await reconcileIndexerPatches(HOST, "key-12345678", "test", {
      selectedIds: [5],
      detachIds: [5],
    });
    expect(res).toEqual({
      ok: true,
      results: [{ id: 5, name: "Example", action: "unchanged", detached: true }],
    });
    expect(putBody?.tags).toEqual([7]);
    expect(getBaseUrlValue(putBody!)).toBe("http://example.test/");
  });

  it("refuses to detach blind when the proxy list cannot be read", async () => {
    const pool = mockAgent.get(HOST);
    pool
      .intercept({ path: "/api/v1/tag", method: "GET" })
      .reply(200, [{ id: 7, label: "umlautadaptarrex" }]);
    pool.intercept({ path: "/api/v1/indexerproxy", method: "GET" }).reply(500, "boom");

    const res = await reconcileIndexerPatches(HOST, "key-12345678", "test", {
      selectedIds: [5],
      detachIds: [5],
    });
    expect(res.ok).toBe(false);
  });
});
