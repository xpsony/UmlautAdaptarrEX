import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { getActiveLanguagePack } from "@/domain/plugins";
import { requiredLanguages } from "@/providers";
import type { TitlePayload, TitleProvider } from "@/providers/types";
import { ArrClient, type ArrClientOptions } from "./base";
import type { RawArrItem } from "./raw-item";

interface RadarrMovie {
  id: number;
  tmdbId?: number;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  year?: number;
  alternateTitles?: {
    sourceType?: string;
    language?: { id?: number; name?: string };
    title: string;
  }[];
}

interface RadarrClientOptions extends ArrClientOptions {
  provider: TitleProvider;
}

const GERMAN_LANG_NAMES = new Set(["German", "german", "de"]);

function pickGermanFromAlternateTitles(movie: RadarrMovie): {
  germanTitle: string | null;
  aliases: string[];
} {
  if (!movie.alternateTitles) return { germanTitle: null, aliases: [] };
  const germanTitles = movie.alternateTitles
    .filter((a) => GERMAN_LANG_NAMES.has(String(a.language?.name ?? "")) || a.language?.id === 4)
    .map((a) => a.title)
    .filter(Boolean);
  const all = movie.alternateTitles.map((a) => a.title).filter(Boolean);
  return {
    germanTitle: germanTitles[0] ?? null,
    aliases: Array.from(new Set([...germanTitles, ...all])),
  };
}

export class RadarrClient extends ArrClient {
  constructor(private readonly ropts: RadarrClientOptions) {
    super(ropts);
  }

  async fetchRawItems(): Promise<RawArrItem[]> {
    const movies = await this.getJson<RadarrMovie[]>("/api/v3/movie");
    if (!movies) return [];
    return movies.filter((m) => m.tmdbId != null).map((m) => toRaw(m));
  }

  async fetchRawItemByExternalId(externalId: string): Promise<RawArrItem | null> {
    const movies = await this.getJson<RadarrMovie[]>("/api/v3/movie", {
      tmdbId: externalId,
    });
    // Defensive find, same reasoning as the Sonarr client: a Radarr that
    // ignores the filter returns the whole library.
    const match = movies?.find((m) => m.tmdbId != null && String(m.tmdbId) === externalId);
    return match ? toRaw(match) : null;
  }

  async deriveItems(raw: RawArrItem[]): Promise<SearchItemDerived[]> {
    if (raw.length === 0) return [];
    // We always ask the provider - even when Radarr already has a German
    // alternate title - because non-DE languages requested by active plugins
    // (sv, fr, ...) cannot be served by Radarr's local data. The German title
    // from Radarr is still preferred (avoids a roundtrip), but we still need
    // sv/fr from TMDB for plugin variations.
    const langs = requiredLanguages(getActiveLanguagePack());
    const onlyDe = langs.length === 1 && langs[0] === "de";
    const idsForProvider = raw.filter((r) => !onlyDe || !r.germanTitle).map((r) => r.externalId);
    const fromProvider = idsForProvider.length
      ? await this.ropts.provider.fetchBulk("movie", idsForProvider, langs)
      : new Map<string, TitlePayload>();

    return raw.map((r) => {
      const provider = fromProvider.get(r.externalId);
      const germanTitle = r.germanTitle ?? provider?.germanTitle ?? null;
      const aliases = [...(r.aliases ?? []), ...(provider?.aliases ?? [])].filter(
        (v, i, a) => a.indexOf(v) === i,
      );
      // Merge local (DE) + provider (all languages) titles. DE preferred from
      // Radarr local data, other languages only available via provider.
      const titlesByLang: Record<string, string> = { ...(provider?.titlesByLang ?? {}) };
      if (germanTitle) titlesByLang["de"] = germanTitle;
      return buildSearchItem({
        arrId: r.arrId,
        externalId: r.externalId,
        // Radarr knows the IMDb id per movie; only used for the newznab
        // `imdb` attribute on rewritten items.
        imdbId: r.imdbId,
        title: r.title,
        expectedTitle: r.title,
        germanTitle,
        titlesByLang: Object.keys(titlesByLang).length > 0 ? titlesByLang : undefined,
        aliases: aliases.length ? aliases : null,
        mediaType: "movie",
        year: r.year,
      });
    });
  }

  async fetchAllItems(): Promise<SearchItemDerived[]> {
    return this.deriveItems(await this.fetchRawItems());
  }
}

function toRaw(m: RadarrMovie): RawArrItem {
  const local = pickGermanFromAlternateTitles(m);
  return {
    arrId: m.id,
    externalId: String(m.tmdbId),
    imdbId: m.imdbId ?? null,
    title: m.title,
    year: m.year && m.year > 0 ? m.year : null,
    aliases: local.aliases.length > 0 ? local.aliases : null,
    germanTitle: local.germanTitle,
    mediaType: "movie",
    expectedAuthor: null,
  };
}
