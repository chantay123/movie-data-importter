import type {
  ImportOperation,
  ImportStatus,
  MatchStatus,
  FieldStatus,
  MergeStrategy,
  ProcessingStage,
} from '../constants/importStatus';
import type { ExtractedMovieData } from './extraction.types';

/**
 * Type definitions shared by the parsing, mapping, comparison and import layers.
 */

/**
 * Shape of a single episode entry as it is stored inside `Movie.episodes`.
 */
export interface EpisodeEntry {
  /** Display name of the episode, usually the episode number. */
  name: string;
  /** Slug identifying the episode. */
  slug: string;
  /** File name of the episode. */
  filename: string;
  /** Embeddable player URL. */
  link_embed: string;
  /** HLS (`.m3u8`) stream URL. */
  link_m3u8: string;
}

/**
 * A group of episodes belonging to one streaming server.
 */
export interface EpisodeServer {
  /** Name of the streaming server, e.g. `Vietsub #1`. */
  server_name: string;
  /** Episodes of the server, in their original order. */
  server_data: EpisodeEntry[];
}

/**
 * Raw JSON payload extracted from a TXT file. It mirrors the crawler output format.
 */
export interface RawMovieJson {
  /** Source identifier of the movie. */
  id?: string;
  /** Movie title. */
  name?: string;
  /** Movie slug. */
  slug?: string;
  /** Original (untranslated) title. */
  originName?: string;
  /** Plot summary. */
  content?: string;
  /** Cast members. */
  actors?: Array<{ name?: string; url?: string }>;
  /** Nested metadata block. */
  info?: RawMovieInfo;
  /** Streaming servers with their episodes. */
  sources?: EpisodeServer[];
  /** Free-form trailer information. */
  trailer?: RawTrailer;
}

/**
 * Nested `info` block of the raw payload.
 */
export interface RawMovieInfo {
  /** List of directors. */
  directors?: string[] | string;
  /** Release year. */
  year?: number | string;
  /** Publication status of the movie. */
  status?: string;
  /** Duration of a single episode. */
  time?: string;
  /** Number of released episodes. */
  episodeCurrent?: number | string;
  /** Total number of episodes. */
  episodeTotal?: number | string;
  /** Video quality label. */
  quality?: string;
  /** View counter reported by the source. */
  view?: number | string;
  /** Trailer URL. */
  trailerUrl?: string;
  /** Thumbnail URL. */
  thumbUrl?: string;
  /** Poster URL. */
  posterUrl?: string;
  /** List of genres. */
  categories?: Array<string | { name?: string; slug?: string }>;
  /** List of countries. */
  countries?: Array<string | { name?: string; slug?: string }>;
  /** Language of the release. */
  languages?: string;
  /** TMDB identifiers. */
  tmdb?: RawTmdb;
}

/**
 * TMDB identifiers carried by the raw payload.
 */
export interface RawTmdb {
  /** TMDB media type, e.g. `movie` or `tv`. */
  type?: string;
  /** TMDB identifier. */
  id?: string | number;
  /** TMDB season number for series. */
  season?: number | string | null;
}

/**
 * Trailer information carried by the raw payload.
 */
export interface RawTrailer {
  /** Trailer title. */
  name?: string;
  /** YouTube video key. */
  key?: string;
  /** Site hosting the trailer. */
  site?: string;
  /** Trailer kind. */
  type?: string;
  /** Whether the trailer is the official one. */
  official?: boolean;
  /** Publication date. */
  publishedAt?: string | null;
  /** Full trailer URL. */
  url?: string;
}

/**
 * A movie mapped onto the MongoDB `Movie` schema. Only fields that were present
 * and valid in the source payload are populated.
 */
export interface MappedMovie {
  /** Source identifier. */
  sourceId?: string;
  /**
   * Name of the crawling source the movie comes from (`ophim`, `nguonc`,
   * `kkphim`). The `Movie` schema uses it to build the compound index
   * `{ source, sourceId }` and to find the movie again on the next crawl.
   */
  source?: string;
  /** Movie title. */
  name?: string;
  /** Movie slug. */
  slug?: string;
  /** Original title. */
  originName?: string;
  /** Plot summary. */
  content?: string;
  /** Movie type (`series`, `single`, `tvshows`, `hoathinh`). */
  type?: string;
  /** Availability status (`upcoming`, `released`, `ended`, `unavailable`). */
  availabilityStatus?: string;
  /** Release date derived from the year. */
  releaseDate?: Date;
  /** Publication status reported by the source. */
  status?: string;
  /** Duration label. */
  time?: string;
  /** Released episode count. */
  episodeCurrent?: string;
  /** Total episode count. */
  episodeTotal?: string;
  /** Language label. */
  lang?: string;
  /** Notification shown on the detail page. */
  notify?: string;
  /** Showtimes of the release. */
  showtimes?: string;
  /** Thumbnail URL. */
  thumbUrl?: string;
  /** Poster URL. */
  posterUrl?: string;
  /**
   * Thumbnail URL published by the `nguonc` source.
   *
   * The `nguonc` payloads carry two sets of images: the ones of the main
   * source (`phimimg.com`) and the ones of `nguonc` itself (`img.nguonc.com`).
   * The crawler stores the `nguonc` ones in `originalThumbUrl` /
   * `originalPosterUrl` before the Cloudinary migration overwrites `thumbUrl` /
   * `posterUrl`.
   */
  originalThumbUrl?: string;
  /** Poster URL published by the `nguonc` source. */
  originalPosterUrl?: string;
  /** Search key of the title, without diacritics and punctuation. */
  name_normalized?: string;
  /** Search key of the original title, without diacritics and punctuation. */
  originName_normalized?: string;
  /** Trailer payload, only present when the source provided a valid one. */
  trailer?: MappedTrailer;
  /** TMDB identifiers. */
  tmdb?: MappedTmdb;
  /** IMDB identifier. */
  imdb?: { id?: string };
  /** Cast members. */
  actor?: string[];
  /** Directors. */
  director?: string[];
  /** Genres. */
  categories?: Array<{ name: string; slug: string }>;
  /** Countries. */
  countries?: Array<{ name: string; slug: string }>;
  /** Streaming servers. */
  episodes?: EpisodeServer[];
  /** Video quality label, stored in the `Format` master data. */
  quality?: string;
  /** Release year, stored in the `Year` master data. */
  year?: number;
  /** Whether the release is a cinema release. */
  chieurap?: boolean;
  /** Backdrop image reported by TMDB. */
  backdropUrl?: string;
}

/**
 * Trailer payload written to MongoDB.
 */
export interface MappedTrailer {
  /** Trailer title, only present when the source provided one. */
  name?: string;
  /** YouTube video key, extracted from the URL when possible. */
  key?: string;
  /** Hosting site. */
  site?: string;
  /** Trailer kind. */
  type?: string;
  /** Whether the trailer is the official one. */
  official?: boolean;
  /** Publication date. */
  publishedAt?: Date | null;
  /** Full trailer URL. */
  url?: string;
}

/**
 * TMDB identifiers written to MongoDB.
 */
export interface MappedTmdb {
  /** TMDB media type. */
  type?: string;
  /** TMDB identifier. */
  id?: string;
  /** TMDB season number. */
  season?: number | null;
}

/**
 * A single validation problem found while parsing or validating a file.
 */
export interface ValidationIssue {
  /** Field the issue relates to. */
  field: string;
  /** Human readable explanation. */
  message: string;
  /** Severity of the issue. */
  severity: 'error' | 'warning';
}

/**
 * Result of parsing a single TXT file.
 */
export interface ParsedMovie {
  /** Original file name. */
  fileName: string;
  /** Size of the file in bytes. */
  fileSize: number;
  /** The parsed payload (undefined when parsing failed). */
  raw?: RawMovieJson;
  /** The movie extracted from a raw TXT payload, when the file was not a plain JSON document. */
  extracted?: ExtractedMovieData;
  /** The payload mapped onto the Movie schema. */
  mapped?: MappedMovie;
  /** Validation issues found for the file. */
  issues: ValidationIssue[];
  /** Whether the file is usable for import. */
  isValid: boolean;
  /** Number of fields that could be read from the payload. */
  readableFieldCount: number;
  /** Total number of episodes found across every server. */
  episodeCount: number;
  /** Total number of streaming servers found. */
  serverCount: number;
  /** Format detected in the raw payload. */
  sourceFormat: string;
  /** Fields of the source payload that the `Movie` schema cannot store. */
  unmappedFields: string[];
  /** Movie name detected in the payload. */
  detectedName?: string;
}

/**
 * A MongoDB movie document, reduced to the fields the importer needs.
 */
export interface ExistingMovie {
  /** Document identifier. */
  _id: string;
  /** Movie title. */
  name?: string;
  /** Movie slug. */
  slug?: string;
  /** Original title. */
  originName?: string;
  /** Plot summary. */
  content?: string;
  /** Release date. */
  releaseDate?: string | null;
  /** Publication status. */
  status?: string;
  /** Movie type. */
  type?: string;
  /** Availability status. */
  availabilityStatus?: string;
  /** Duration label. */
  time?: string;
  /** Released episode count. */
  episodeCurrent?: string;
  /** Total episode count. */
  episodeTotal?: string;
  /** Thumbnail URL. */
  thumbUrl?: string;
  /** Poster URL. */
  posterUrl?: string;
  /** Backdrop URL. */
  backdropUrl?: string;
  /** Whether the release is a cinema release. */
  chieurap?: boolean;
  /** Search key of the title. */
  name_normalized?: string;
  /** Search key of the original title. */
  originName_normalized?: string;
  /** Poster URL published by the `nguonc` source, kept before the Cloudinary migration. */
  originalPosterUrl?: string;
  /** Thumbnail URL published by the `nguonc` source, kept before the Cloudinary migration. */
  originalThumbUrl?: string;
  /** Notification shown on the detail page. */
  notify?: string;
  /** Showtimes of the release. */
  showtimes?: string;
  /** Cast members. */
  actor?: string[];
  /** Directors. */
  director?: string[];
  /** Episode servers. */
  episodes?: EpisodeServer[];
  /** Source identifier. */
  sourceId?: string;
  /** Name of the crawling source. */
  source?: string;
  /** TMDB identifiers. */
  tmdb?: MappedTmdb;
  /** Trailer payload. */
  trailer?: MappedTrailer;
  /** Language label. */
  lang?: string;
  /** Last modification timestamp, used for the optimistic concurrency check. */
  updatedAt?: string;
}

/**
 * Outcome of the database lookup for one parsed movie.
 */
export interface MatchResult {
  /** Outcome of the lookup. */
  status: MatchStatus;
  /** Criterion that produced the match. */
  matchedBy?: 'sourceId' | 'tmdb' | 'slug' | 'name' | 'originName';
  /** The matched document (single match). */
  movie?: ExistingMovie;
  /** Every candidate found (more than one for ambiguous results). */
  candidates: ExistingMovie[];
  /** Explanation of the lookup result. */
  message?: string;
}

/**
 * Comparison of a single field between the database document and the new payload.
 */
export interface FieldDiff {
  /** Name of the field in the MongoDB schema. */
  field: string;
  /** Value currently stored in MongoDB. */
  currentValue?: unknown;
  /** Value coming from the TXT payload. */
  incomingValue?: unknown;
  /** Comparison outcome. */
  status: FieldStatus;
  /** Merge strategy to apply for array fields. */
  mergeStrategy?: MergeStrategy;
  /** Explanation shown to the user. */
  message?: string;
  /** Whether the field is protected and can never be written. */
  isProtected?: boolean;
}

/**
 * Comparison result for one movie.
 */
export interface MovieComparison {
  /** Identifier of the file the comparison belongs to. */
  fileId: string;
  /** Outcome of the database lookup. */
  matchStatus: MatchStatus;
  /** Criterion that produced the match. */
  matchedBy?: MatchResult['matchedBy'];
  /** The matched document, when a single candidate was found. */
  existing?: ExistingMovie;
  /** All candidates, used for ambiguous matches. */
  candidates: ExistingMovie[];
  /** Field level comparison. */
  diffs: FieldDiff[];
  /** Fields that are safe to write. */
  updatableFields: string[];
}

/**
 * Tracking information for a single file inside a job.
 */
export interface FileProgress {
  /** Stable identifier of the file inside the job. */
  id: string;
  /** Name of the file. */
  fileName: string;
  /** Size of the file in bytes. */
  fileSize: number;
  /** Current status. */
  status: ImportStatus;
  /** Current stage. */
  stage: ProcessingStage;
  /** Completion percentage between 0 and 100. */
  progress: number;
  /** Movie name detected in the file. */
  detectedName?: string;
  /** Number of readable data fields. */
  readableFieldCount: number;
  /** Number of episodes found. */
  episodeCount: number;
  /** Number of streaming servers found. */
  serverCount?: number;
  /** Format detected in the raw payload. */
  sourceFormat?: string;
  /** Outcome of the database lookup. */
  matchStatus?: MatchStatus;
  /** Identifier of the matched document. */
  existingMovieId?: string;
  /** Timestamp of the beginning of the processing. */
  startedAt?: string;
  /** Timestamp of the end of the processing. */
  finishedAt?: string;
  /** Error message when the file failed. */
  error?: string;
  /** Parsed payload, available for preview. */
  parsed?: ParsedMovie;
}

/**
 * Aggregate counters of a job.
 */
export interface JobCounters {
  /** Total number of files. */
  total: number;
  /** Files fully processed. */
  processed: number;
  /** Files that succeeded. */
  success: number;
  /** Files that failed. */
  failed: number;
  /** Files waiting for a manual decision. */
  needsReview: number;
  /** Files skipped. */
  skipped: number;
  /** Files cancelled. */
  cancelled: number;
  /** Files currently being processed. */
  processing: number;
  /** Files that were imported into MongoDB. */
  imported: number;
  /** Overall completion percentage between 0 and 100. */
  overallProgress: number;
}

/**
 * A single write performed against MongoDB.
 */
export interface ImportLogEntry {
  /** Identifier of the file. */
  fileId: string;
  /** Name of the file. */
  fileName: string;
  /** Movie title. */
  movieName: string;
  /** Slug of the movie. */
  slug: string;
  /** Identifier of the written document. */
  movieId?: string;
  /** Type of the write. */
  operation: ImportOperation;
  /** Fields that were written. */
  updatedFields: string[];
  /** Outcome of the write. */
  status: ImportStatus;
  /** Error message when the write failed. */
  error?: string;
  /** Timestamp of the write. */
  timestamp: string;
}

/**
 * The state of a whole import job.
 */
export interface ImportJob {
  /** Unique identifier of the job. */
  id: string;
  /** Creation timestamp. */
  createdAt: string;
  /** Last update timestamp. */
  updatedAt: string;
  /** Whether the job was cancelled. */
  cancelled: boolean;
  /** Aggregate counters. */
  counters: JobCounters;
  /** Progress of every file. */
  files: FileProgress[];
  /** Import log. */
  logs: ImportLogEntry[];
}

/**
 * Events emitted over the SSE stream.
 */
export type ImportEvent =
  | { type: 'job:created'; job: ImportJob }
  | { type: 'job:updated'; job: ImportJob }
  | { type: 'file:updated'; file: FileProgress; jobId: string }
  | { type: 'log:added'; log: ImportLogEntry; jobId: string }
  | { type: 'job:completed'; job: ImportJob };
