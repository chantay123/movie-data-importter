/**
 * Type definitions of the extraction layer.
 *
 * The extraction layer is responsible for turning a raw TXT payload into a
 * normalized movie description, whatever the format of the file is.
 */

/**
 * Format of the raw TXT payload.
 */
export enum SourceFormat {
  /** A plain JSON document (the output of the crawler). */
  JSON_DOCUMENT = 'JSON_DOCUMENT',
  /** A React Flight / Next.js Server Component payload. */
  REACT_FLIGHT = 'REACT_FLIGHT',
  /** A JSON document embedded inside HTML or plain text. */
  EMBEDDED_JSON = 'EMBEDDED_JSON',
  /** A raw HTML page that embeds the data in a script tag. */
  HTML = 'HTML',
  /** The format could not be determined. */
  UNKNOWN = 'UNKNOWN',
}

/**
 * A single episode as it is carried by the source payload.
 */
export interface ExtractedEpisode {
  /** Display name of the episode, usually `Tập 1`. */
  name?: string;
  /** Slug of the episode. */
  slug?: string;
  /** Position of the episode inside its language group. */
  episodeNumber?: number;
  /** Embeddable player URL. */
  linkEmbed?: string;
  /** HLS (`.m3u8`) stream URL. */
  linkM3u8?: string;
  /** Direct download URL. */
  linkDirect?: string;
}

/**
 * A group of episodes sharing the same language inside a server.
 */
export interface ExtractedLanguage {
  /** Name of the language, e.g. `Vietsub`. */
  name?: string;
  /** Slug of the language. */
  slug?: string;
  /** Short key of the language. */
  key?: string;
  /** Episodes of the language, in their original order. */
  episodes: ExtractedEpisode[];
}

/**
 * A streaming server with its language groups.
 */
export interface ExtractedSource {
  /** Name of the server, e.g. `KKPhim`. */
  serverName?: string;
  /** Stable key of the server, e.g. `kkphim`. */
  serverKey?: string;
  /** Language groups of the server. */
  languages: ExtractedLanguage[];
}

/**
 * A named entity (genre, country, language) with its optional slug.
 */
export interface ExtractedNamedEntity {
  /** Display name. */
  name: string;
  /** Slug of the entity. */
  slug?: string;
  /** Identifier of the entity. */
  id?: string;
}

/**
 * A cast member coming from the TMDB payload.
 */
export interface ExtractedCastMember {
  /** Name of the actor. */
  name: string;
  /** Character played by the actor. */
  character?: string;
}

/**
 * The movie description extracted from a raw TXT payload.
 *
 * Every field is optional: only the data that was actually present in the
 * payload is filled in.
 */
export interface ExtractedMovieData {
  /** Source identifier of the movie. */
  id?: string;
  /** Movie title. */
  name?: string;
  /** Movie slug. */
  slug?: string;
  /** Original (untranslated) title. */
  originName?: string;
  /** Plot summary, possibly containing HTML. */
  content?: string;
  /** Movie type, e.g. `series` or `single`. */
  type?: string;
  /**
   * Format groups reported by the source, e.g. `Phim Bộ`, `Phim Lẻ`,
   * `TV Shows`. The first group describes the format of the movie and is
   * stored in the `Format` master data.
   */
  typeList?: ExtractedNamedEntity[];
  /**
   * Identifier of the format group of the movie, used when the payload only
   * carries the identifier and not the group itself.
   */
  typeListId?: string;
  /**
   * Key of the crawling source, deduced from the servers of the movie
   * (`kkphim`, `nguonc`, `onflix`, `vicdn`, `vsphim`).
   */
  sourceKey?: string;
  /** Publication status, e.g. `ongoing` or `completed`. */
  status?: string;
  /** Release year. */
  year?: number;
  /** Thumbnail URL. */
  thumbUrl?: string;
  /** Poster URL. */
  posterUrl?: string;
  /** Thumbnail URL published by the `nguonc` source. */
  thumbUrlNguonc?: string;
  /** Poster URL published by the `nguonc` source. */
  posterUrlNguonc?: string;
  /** Duration of a single episode. */
  time?: string;
  /** Released episode count or label. */
  episodeCurrent?: string;
  /** Total episode count. */
  episodeTotal?: string;
  /** Video quality label. */
  quality?: string;
  /** View counter reported by the source. */
  view?: number;
  /** Whether the release is a cinema release. */
  isChieuRap?: boolean;
  /** Trailer URL. */
  trailerUrl?: string;
  /** Notification shown on the detail page. */
  notify?: string;
  /** Showtimes of the release. */
  showtimes?: string;
  /** Cast members, as a list of names. */
  actors?: string[];
  /** Directors, as a list of names. */
  directors?: string[];
  /** Genres. */
  categories?: ExtractedNamedEntity[];
  /** Countries. */
  countries?: ExtractedNamedEntity[];
  /** Languages of the release. */
  languages?: ExtractedNamedEntity[];
  /** TMDB identifiers. */
  tmdb?: {
    /** Internal identifier of the TMDB entry. */
    id?: string;
    /** Numeric TMDB identifier. */
    tmdbId?: string;
    /** Media type, e.g. `tv` or `movie`. */
    type?: string;
    /** Season number for series. */
    season?: number;
    /** Average vote. */
    voteAverage?: number;
    /** Vote count. */
    voteCount?: number;
  };
  /** Streaming servers with their episodes. */
  sources: ExtractedSource[];
  /** Cast members with their character, coming from the TMDB payload. */
  cast?: ExtractedCastMember[];
  /** Backdrop paths reported by TMDB. */
  backdrops?: string[];
  /** Fields of the source payload that the `Movie` schema cannot store. */
  unmappedFields: string[];
}

/**
 * Result of the extraction of a raw TXT payload.
 */
export interface ExtractionResult {
  /** Whether the extraction succeeded. */
  success: boolean;
  /** Format detected in the payload. */
  format: SourceFormat;
  /** The extracted movie, when the extraction succeeded. */
  data?: ExtractedMovieData;
  /** Every candidate found in the payload, used when several are present. */
  candidates: ExtractedMovieData[];
  /** Explanation of the result, shown to the user. */
  message?: string;
}
