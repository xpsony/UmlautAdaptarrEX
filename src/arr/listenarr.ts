import { getReadarrTitleForExternalId } from "@/domain/normalization/index";
import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { ArrClient, type ArrClientOptions } from "./base";
import type { RawArrItem } from "./raw-item";

interface ListenarrAudiobook {
  id: number;
  title?: string | null;
  authors?: string[] | null;
  series?: string | null;
}

export class ListenarrClient extends ArrClient {
  // Listenarr's ApiKeyMiddleware accepts X-Api-Key (or `Authorization: ApiKey`)
  // and deliberately refuses query-string auth outside its SignalR hubs.
  protected readonly apiKeyTransport = "header" as const;

  constructor(opts: ArrClientOptions) {
    super(opts);
  }

  /**
   * Listenarr serves the whole library flat under one endpoint, so there is no
   * parent/child walk to do and `fetchNested` stays unused here.
   */
  async fetchRawItems(): Promise<RawArrItem[]> {
    const books = await this.getJson<ListenarrAudiobook[]>("/api/v1/library");
    if (!books) return [];

    const out: RawArrItem[] = [];
    for (const book of books) {
      const title = book.title?.trim();
      // Listenarr puts the first author in its search query, so that is the
      // one we key and match on.
      const author = book.authors?.[0]?.trim();
      // Without an author `buildSearchItem` falls into the tv/movie branch and
      // produces variations that never match an audiobook release.
      if (!title || !author) continue;

      const series = book.series?.trim();
      out.push({
        arrId: book.id,
        // Mirrors AutomaticSearchResultClassifier.BuildSearchQuery: title,
        // then first author, then series when there is one. The series-less
        // spelling is the primary key because the series is optional.
        externalId: getReadarrTitleForExternalId(`${title} ${author}`),
        externalIdAliases: series
          ? [getReadarrTitleForExternalId(`${title} ${author} ${series}`)]
          : null,
        imdbId: null,
        title,
        year: null,
        aliases: null,
        germanTitle: null,
        mediaType: "book",
        expectedAuthor: author,
      });
    }
    return out;
  }

  // No TitleProvider is consulted for books, same as Lidarr and Readarr.
  async deriveItems(raw: RawArrItem[]): Promise<SearchItemDerived[]> {
    return raw.map((r) =>
      buildSearchItem({
        arrId: r.arrId,
        externalId: r.externalId,
        externalIdAliases: r.externalIdAliases,
        title: r.title,
        expectedTitle: r.title,
        expectedAuthor: r.expectedAuthor,
        mediaType: "book",
      }),
    );
  }
}
