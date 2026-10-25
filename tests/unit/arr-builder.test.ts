import { describe, expect, it } from "vitest";
import { buildArrClient } from "@/arr";
import { LidarrClient } from "@/arr/lidarr";
import { ListenarrClient } from "@/arr/listenarr";
import { RadarrClient } from "@/arr/radarr";
import { ReadarrClient } from "@/arr/readarr";
import { SonarrClient } from "@/arr/sonarr";
import type { TitleProvider } from "@/providers/types";

const provider: TitleProvider = {
  name: "stub",
  supportedLanguages: () => ["de"],
  fetchByExternalId: async () => null,
  fetchByTitle: async () => null,
  fetchBulk: async () => new Map(),
};

const common = {
  instanceId: "i",
  instanceName: "n",
  host: "http://x",
  apiKey: "k",
  userAgent: "UA",
  provider,
};

describe("buildArrClient", () => {
  it("returns a SonarrClient for type=sonarr", () => {
    expect(buildArrClient({ ...common, type: "sonarr" })).toBeInstanceOf(SonarrClient);
  });

  it("returns a RadarrClient for type=radarr", () => {
    expect(buildArrClient({ ...common, type: "radarr" })).toBeInstanceOf(RadarrClient);
  });

  it("returns a LidarrClient for type=lidarr", () => {
    expect(buildArrClient({ ...common, type: "lidarr" })).toBeInstanceOf(LidarrClient);
  });

  it("returns a ReadarrClient for type=readarr", () => {
    expect(buildArrClient({ ...common, type: "readarr" })).toBeInstanceOf(ReadarrClient);
  });

  it("returns a ListenarrClient for type=listenarr", () => {
    expect(buildArrClient({ ...common, type: "listenarr" })).toBeInstanceOf(ListenarrClient);
  });
});
