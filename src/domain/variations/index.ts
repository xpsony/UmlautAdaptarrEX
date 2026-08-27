import { getActiveLanguagePack, hasMappedChar, type LanguagePack } from "../plugins";
import { type BooksAudioVariationOutput, generateForBooksAndAudio } from "./books-audio";
import { generateForTvMovie, type TvMovieVariationOutput } from "./tv-movie";
import type { MediaType } from "./generate";

export { generateVariations } from "./generate";

export interface SearchItemInput {
  arrId: number;
  externalId: string;
  /**
   * IMDb id, when the *Arr client has one (Radarr does per movie). Carried
   * through untouched - it takes no part in variation generation, it is only
   * persisted so the rewrite can emit a newznab `imdb` attribute.
   */
  imdbId?: string | null;
  title: string;
  expectedTitle: string;
  expectedAuthor?: string | null;
  germanTitle?: string | null;
  /**
   * Per-language titles from the title provider. Used by the multi-language
   * variations path (`generateForTvMovie`) to feed active non-DE plugins
   * with their own language title. Optional: backward-compat callers without
   * this map behave like 1.x.
   */
  titlesByLang?: Record<string, string> | null | undefined;
  mediaType: MediaType;
  aliases?: string[] | null;
  /**
   * Release year for movies, first-air year for TV. Used by the matching
   * layer to reject false-positive title matches when the release carries
   * a different 4-digit year (Formula-1 race vs. F1 movie franchise alias).
   */
  year?: number | null;
}

export interface SearchItemDerived {
  arrId: number;
  externalId: string;
  imdbId: string | null;
  title: string;
  expectedTitle: string;
  expectedAuthor: string | null;
  germanTitle: string | null;
  mediaType: MediaType;
  aliases: string[] | null;
  hasUmlaut: boolean;
  year: number | null;
  titleSearchVariations: string[];
  titleMatchVariations: string[];
  authorMatchVariations: string[];
}

export function buildSearchItem(
  input: SearchItemInput,
  pack: LanguagePack = getActiveLanguagePack(),
): SearchItemDerived {
  const base = {
    arrId: input.arrId,
    externalId: input.externalId,
    imdbId: input.imdbId ?? null,
    title: input.title,
    expectedTitle: input.expectedTitle,
    expectedAuthor: input.expectedAuthor ?? null,
    mediaType: input.mediaType,
    hasUmlaut: hasMappedChar(input.title, pack.comparisonMap),
    year: input.year ?? null,
  };

  if ((input.mediaType === "audio" || input.mediaType === "book") && input.expectedAuthor) {
    const v: BooksAudioVariationOutput = generateForBooksAndAudio(
      {
        expectedTitle: input.expectedTitle,
        expectedAuthor: input.expectedAuthor,
        mediaType: input.mediaType,
      },
      pack,
    );
    return {
      ...base,
      germanTitle: input.germanTitle ?? null,
      aliases: input.aliases ?? null,
      ...v,
    };
  }

  const tv: TvMovieVariationOutput = generateForTvMovie(
    {
      germanTitle: input.germanTitle,
      titlesByLang: input.titlesByLang,
      expectedTitle: input.expectedTitle,
      aliases: input.aliases,
      mediaType: input.mediaType as "tv" | "movie",
    },
    pack,
  );
  return {
    ...base,
    germanTitle: tv.germanTitle,
    aliases: tv.aliases,
    titleSearchVariations: tv.titleSearchVariations,
    titleMatchVariations: tv.titleMatchVariations,
    authorMatchVariations: tv.authorMatchVariations,
  };
}
