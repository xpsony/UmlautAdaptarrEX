import { getReadarrTitleForExternalId } from "@/domain/normalization/index";
import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { ArrClient, type ArrClientOptions } from "./base";

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

  async fetchAllItems(): Promise<SearchItemDerived[]> {
    return this.fetchNested<ReadarrAuthor, ReadarrBook>({
      parentPath: "/api/v1/author",
      childPath: "/api/v1/book",
      childParams: (author) => ({ authorId: String(author.id) }),
      map: (author, book) => {
        const cleaned = cleanBookTitle(book.title, author.authorName);
        return buildSearchItem({
          arrId: author.id,
          externalId: getReadarrTitleForExternalId(`${cleaned} ${author.authorName}`),
          title: cleaned,
          expectedTitle: cleaned,
          expectedAuthor: author.authorName,
          mediaType: "book",
        });
      },
    });
  }
}
