export type MediaType = "tv" | "movie" | "audio" | "book";

export interface Item {
  id: string;
  arrId: number;
  externalId: string;
  title: string;
  expectedTitle: string;
  expectedAuthor: string | null;
  germanTitle: string | null;
  mediaType: MediaType;
  year: number | null;
  titleSearchVariations: string[];
  titleMatchVariations: string[];
  authorMatchVariations: string[];
  aliases: string[] | null;
  updatedAt: string;
  instance: { id: string; name: string; type: string };
  override: string | null;
}
