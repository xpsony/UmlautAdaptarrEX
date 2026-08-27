import { getReadarrTitleForExternalId } from "@/domain/normalization/index";
import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { ArrClient, type ArrClientOptions } from "./base";
import type { RawArrItem } from "./raw-item";

interface ReadarrAuthor {
  id: number;
  authorName: string;
}

interface ReadarrBook {
  id: number;
  authorId: number;
  title: string;
}

function cleanBookTitle(title: string, authorName: string): string {
  let result = title;
  const prefix = `${authorName}: `;
  if (result.startsWith(prefix)) {
    result = result.slice(prefix.length);
  }
  const parenIdx = result.indexOf("(");
  if (parenIdx > 0) result = result.slice(0, parenIdx).trim();
  const colonIdx = result.indexOf(":");
  if (colonIdx > 0) result = result.slice(0, colonIdx).trim();
  return result;
}

export class ReadarrClient extends ArrClient {
  constructor(opts: ArrClientOptions) {
    super(opts);
  }

  async fetchRawItems(): Promise<RawArrItem[]> {
    return this.fetchNested<ReadarrAuthor, ReadarrBook, RawArrItem>({
      parentPath: "/api/v1/author",
      childPath: "/api/v1/book",
      childParams: (author) => ({ authorId: String(author.id) }),
      map: (author, book) => {
        const cleaned = cleanBookTitle(book.title, author.authorName);
        return {
          arrId: author.id,
          externalId: getReadarrTitleForExternalId(`${cleaned} ${author.authorName}`),
          imdbId: null,
          title: cleaned,
          year: null,
          aliases: null,
          germanTitle: null,
          mediaType: "book",
          expectedAuthor: author.authorName,
        };
      },
    });
  }

  // No TitleProvider is consulted for books, same as Lidarr.
  async deriveItems(raw: RawArrItem[]): Promise<SearchItemDerived[]> {
    return raw.map((r) =>
      buildSearchItem({
        arrId: r.arrId,
        externalId: r.externalId,
        title: r.title,
        expectedTitle: r.title,
        expectedAuthor: r.expectedAuthor,
        mediaType: "book",
      }),
    );
  }

  async fetchAllItems(): Promise<SearchItemDerived[]> {
    return this.deriveItems(await this.fetchRawItems());
  }
}
