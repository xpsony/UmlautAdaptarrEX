import { getLidarrTitleForExternalId } from "@/domain/normalization/index";
import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { ArrClient, type ArrClientOptions } from "./base";
import type { RawArrItem } from "./raw-item";

interface LidarrArtist {
  id: number;
  artistName: string;
}

interface LidarrAlbum {
  id: number;
  artistId: number;
  title: string;
  foreignAlbumId?: string;
}

export class LidarrClient extends ArrClient {
  constructor(opts: ArrClientOptions) {
    super(opts);
  }

  async fetchRawItems(): Promise<RawArrItem[]> {
    return this.fetchNested<LidarrArtist, LidarrAlbum, RawArrItem>({
      parentPath: "/api/v1/artist",
      childPath: "/api/v1/album",
      childParams: (artist) => ({ artistId: String(artist.id) }),
      map: (artist, album) => ({
        arrId: artist.id,
        externalId: getLidarrTitleForExternalId(`${artist.artistName} ${album.title}`),
        imdbId: null,
        title: album.title,
        year: null,
        aliases: null,
        germanTitle: null,
        mediaType: "audio",
        expectedAuthor: artist.artistName,
      }),
    });
  }

  // No TitleProvider is consulted for audio: `buildSearchItem` derives every
  // variation from the title/author pair alone.
  async deriveItems(raw: RawArrItem[]): Promise<SearchItemDerived[]> {
    return raw.map((r) =>
      buildSearchItem({
        arrId: r.arrId,
        externalId: r.externalId,
        title: r.title,
        expectedTitle: r.title,
        expectedAuthor: r.expectedAuthor,
        mediaType: "audio",
      }),
    );
  }

  async fetchAllItems(): Promise<SearchItemDerived[]> {
    return this.deriveItems(await this.fetchRawItems());
  }
}
