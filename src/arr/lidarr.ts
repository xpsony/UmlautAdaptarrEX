import { lidarrAlbumSearchKeys } from "@/domain/normalization/index";
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
  disambiguation?: string | null;
  /** ISO date, e.g. "2004-03-01T00:00:00Z"; null when Lidarr knows none. */
  releaseDate?: string | null;
}

// Year straight off the ISO prefix: going through Date would shift a
// midnight-UTC release into the previous year in time zones west of UTC.
function releaseYear(releaseDate: string | null | undefined): number | null {
  const m = typeof releaseDate === "string" ? /^(\d{4})-/.exec(releaseDate) : null;
  return m ? Number(m[1]) : null;
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
      map: (artist, album) => {
        // The externalId is the search Lidarr itself sends, so the legacy
        // `t=search` route can find the album from `q` alone. A second key
        // covers indexers that make Lidarr send raw names.
        const [externalId, ...aliases] = lidarrAlbumSearchKeys({
          artist: artist.artistName,
          album: album.title,
          disambiguation: album.disambiguation,
          year: releaseYear(album.releaseDate),
        });
        return {
          arrId: artist.id,
          externalId: externalId!,
          externalIdAliases: aliases.length > 0 ? aliases : null,
          imdbId: null,
          title: album.title,
          year: null,
          aliases: null,
          germanTitle: null,
          mediaType: "audio",
          expectedAuthor: artist.artistName,
        };
      },
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
}
