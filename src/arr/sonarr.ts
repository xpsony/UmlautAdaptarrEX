import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { getActiveLanguagePack } from "@/domain/plugins";
import { requiredLanguages } from "@/providers";
import type { TitleProvider } from "@/providers/types";
import { ArrClient, type ArrClientOptions } from "./base";
import type { RawArrItem } from "./raw-item";

interface SonarrSeries {
  id: number;
  tvdbId?: number;
  title: string;
  year?: number;
  alternateTitles?: { title: string }[];
}

interface SonarrClientOptions extends ArrClientOptions {
  provider: TitleProvider;
}

export class SonarrClient extends ArrClient {
  constructor(private readonly sopts: SonarrClientOptions) {
    super(sopts);
  }

  async fetchRawItems(): Promise<RawArrItem[]> {
    const series = await this.getJson<SonarrSeries[]>("/api/v3/series", {
      includeSeasonImages: "false",
    });
    if (!series) return [];
    return series.filter((s) => s.tvdbId != null).map((s) => toRaw(s));
  }

  async fetchRawItemByExternalId(externalId: string): Promise<RawArrItem | null> {
    const series = await this.getJson<SonarrSeries[]>("/api/v3/series", {
      tvdbId: externalId,
      includeSeasonImages: "false",
    });
    // Defensive find: an older Sonarr that ignores the tvdbId filter returns
    // the whole library, and we must not pick an arbitrary entry from it.
    const match = series?.find((s) => s.tvdbId != null && String(s.tvdbId) === externalId);
    return match ? toRaw(match) : null;
  }

  async deriveItems(raw: RawArrItem[]): Promise<SearchItemDerived[]> {
    if (raw.length === 0) return [];
    const langs = requiredLanguages(getActiveLanguagePack());
    const titles = await this.sopts.provider.fetchBulk(
      "tv",
      raw.map((r) => r.externalId),
      langs,
    );
    return raw.map((r) => {
      const payload = titles.get(r.externalId);
      // Union, not fallback: Sonarr's own `alternateTitles` (its cached TVDB
      // alias list) and the provider aliases each carry names the other
      // lacks, and Sonarr's list is often where the German name hides for a
      // series whose expectedTitle is the English TVDB translation.
      const aliases = Array.from(new Set([...(payload?.aliases ?? []), ...(r.aliases ?? [])]));
      return buildSearchItem({
        arrId: r.arrId,
        externalId: r.externalId,
        title: r.title,
        expectedTitle: r.title,
        germanTitle: payload?.germanTitle ?? null,
        titlesByLang: payload?.titlesByLang,
        aliases: aliases.length > 0 ? aliases : null,
        mediaType: "tv",
        year: r.year,
      });
    });
  }
}

function toRaw(s: SonarrSeries): RawArrItem {
  const aliases = s.alternateTitles?.map((a) => a.title).filter(Boolean) ?? [];
  return {
    arrId: s.id,
    externalId: String(s.tvdbId),
    imdbId: null,
    title: s.title,
    year: s.year && s.year > 0 ? s.year : null,
    aliases: aliases.length > 0 ? aliases : null,
    germanTitle: null,
    mediaType: "tv",
    expectedAuthor: null,
  };
}
