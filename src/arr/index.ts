import type { TitleProvider } from "@/providers/types";
import type { ArrType } from "@/schemas/instance";
import { type ArrClient, type ArrClientOptions } from "./base";
import { LidarrClient } from "./lidarr";
import { RadarrClient } from "./radarr";
import { ReadarrClient } from "./readarr";
import { SonarrClient } from "./sonarr";

export interface BuildArrClientOptions extends ArrClientOptions {
  type: ArrType;
  provider: TitleProvider;
}

export function buildArrClient(opts: BuildArrClientOptions): ArrClient {
  switch (opts.type) {
    case "sonarr":
      return new SonarrClient(opts);
    case "radarr":
      return new RadarrClient(opts);
    case "lidarr":
      return new LidarrClient(opts);
    case "readarr":
      return new ReadarrClient(opts);
  }
}
