import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { getActiveLanguagePack } from "@/domain/plugins";
import { requiredLanguages } from "@/providers";
import type { TitleProvider } from "@/providers/types";
import { ArrClient, type ArrClientOptions } from "./base";

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

  async fetchAllItems(): Promise<SearchItemDerived[]> {
    const movies = await this.getJson<RadarrMovie[]>("/api/v3/movie");
    if (!movies) return [];

    // We always ask the provider - even when Radarr already has a German
    // alternate title - because non-DE languages requested by active plugins
    // (sv, fr, …) cannot be served by Radarr's local data. The German title
    // from Radarr is still preferred (avoids a roundtrip), but we still need
    // sv/fr from TMDB for plugin variations.
    const langs = requiredLanguages(getActiveLanguagePack());
    const onlyDe = langs.length === 1 && langs[0] === "de";

    const idsForProvider = movies
      .filter((m) => m.tmdbId != null)
      .filter((m) => !onlyDe || !pickGermanFromAlternateTitles(m).germanTitle)
      .map((m) => String(m.tmdbId));
    const fromProvider = idsForProvider.length
      ? await this.ropts.provider.fetchBulk("movie", idsForProvider, langs)
      : new Map();

    return movies
      .filter((m) => m.tmdbId != null)
      .map((m) => {
        const local = pickGermanFromAlternateTitles(m);
        const externalId = String(m.tmdbId);
        const provider = fromProvider.get(externalId);
        const germanTitle = local.germanTitle ?? provider?.germanTitle ?? null;
        const aliases = [...local.aliases, ...(provider?.aliases ?? [])].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        // Merge local (DE) + provider (all languages) titles. DE preferred
        // from Radarr local data, other languages only available via provider.
        const titlesByLang: Record<string, string> = {
          ...(provider?.titlesByLang ?? {}),
        };
        if (germanTitle) titlesByLang["de"] = germanTitle;
        return buildSearchItem({
          arrId: m.id,
          externalId,
          // Radarr knows the IMDb id per movie; only used for the newznab
          // `imdb` attribute on rewritten items.
          imdbId: m.imdbId ?? null,
          title: m.title,
          expectedTitle: m.title,
          germanTitle,
          titlesByLang: Object.keys(titlesByLang).length > 0 ? titlesByLang : undefined,
          aliases: aliases.length ? aliases : null,
          mediaType: "movie",
          year: m.year && m.year > 0 ? m.year : null,
        });
      });
  }
}
