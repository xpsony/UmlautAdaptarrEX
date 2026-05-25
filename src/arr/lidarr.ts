import { getLidarrTitleForExternalId } from "@/domain/normalization/index";
import { buildSearchItem, type SearchItemDerived } from "@/domain/variations/index";
import { ArrClient, type ArrClientOptions } from "./base";

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

  async fetchAllItems(): Promise<SearchItemDerived[]> {
    return this.fetchNested<LidarrArtist, LidarrAlbum>({
      parentPath: "/api/v1/artist",
      childPath: "/api/v1/album",
      childParams: (artist) => ({ artistId: String(artist.id) }),
      map: (artist, album) =>
        buildSearchItem({
          arrId: artist.id,
          externalId: getLidarrTitleForExternalId(`${artist.artistName} ${album.title}`),
          title: album.title,
          expectedTitle: album.title,
          expectedAuthor: artist.artistName,
          mediaType: "audio",
        }),
    });
  }
}
