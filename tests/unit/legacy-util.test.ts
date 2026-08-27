import { describe, expect, it } from "vitest";
import {
  buildIndexerUrl,
  buildVariationSearch,
} from "@/server/routes/legacy/util.js";

describe("buildIndexerUrl", () => {
  // Old .NET UrlUtilities.BuildUrl always used UriBuilder("https", domain).
  // Plain HTTP often gets 301-redirected and some indexers refuse it.
  it("uses https:// to match legacy .NET behaviour", () => {
    expect(
      buildIndexerUrl({
        apiKey: "k",
        domain: "indexer.example.com/api",
        search: "t=tvsearch&q=foo",
      }),
    ).toBe("https://indexer.example.com/api?t=tvsearch&q=foo");
  });

  it("omits the question mark when search is empty", () => {
    expect(
      buildIndexerUrl({ apiKey: "k", domain: "host/api", search: "" }),
    ).toBe("https://host/api");
  });
});

describe("buildVariationSearch", () => {
  // Old SearchControllerBase.BaseSearch removes ID params before issuing
  // German-variation queries - otherwise the indexer ignores `q` entirely.
  it("strips tvdbid/tmdbid/imdbid/rid/tvmazeid and replaces q", () => {
    const out = buildVariationSearch(
      "t=tvsearch&tvdbid=121361&tvmazeid=42&imdbid=tt000&rid=1&tmdbid=2&q=Realm+of+Ravens&season=1",
      "Lied der Schwarzen Raben",
    );
    const params = new URLSearchParams(out);
    expect(params.has("tvdbid")).toBe(false);
    expect(params.has("tvmazeid")).toBe(false);
    expect(params.has("imdbid")).toBe(false);
    expect(params.has("rid")).toBe(false);
    expect(params.has("tmdbid")).toBe(false);
    expect(params.get("q")).toBe("Lied der Schwarzen Raben");
    expect(params.get("season")).toBe("1");
    expect(params.get("t")).toBe("tvsearch");
  });

  it("adds q when not previously present", () => {
    const out = buildVariationSearch("t=tvsearch&cat=5040", "Foo");
    const params = new URLSearchParams(out);
    expect(params.get("q")).toBe("Foo");
    expect(params.get("cat")).toBe("5040");
  });
});
