import {
  FieldStatus,
  ImportOperation,
  ImportStatus,
  MatchStatus,
  MergeStrategy,
  ProcessingStage,
} from './movieImport.types';

/**
 * A single episode entry of a movie.
 */
export interface EpisodeEntry {
  name: string;
  slug: string;
  filename: string;
  link_embed: string;
  link_m3u8: string;
}

/**
 * A group of episodes belonging to one streaming server.
 */
export interface EpisodeServer {
  server_name: string;
  server_data: EpisodeEntry[];
}

/**
 * A movie document reduced to the fields used by the comparison.
 */
export interface ExistingMovie {
  _id: string;
  name?: string;
  slug?: string;
  originName?: string;
  releaseDate?: string | null;
  actor?: string[];
  director?: string[];
  episodes?: EpisodeServer[];
  sourceId?: string;
  tmdb?: { id?: string; type?: string; season?: number | null };
  trailer?: Record<string, unknown>;
  lang?: string;
  updatedAt?: string;
}

/**
 * Validation issue reported for a file.
 */
export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Parsed payload of a file.
 */
export interface ParsedMovie {
  fileName: string;
  fileSize: number;
  raw?: Record<string, unknown> | null;
  extracted?: Record<string, unknown> | null;
  mapped?: Record<string, unknown> | null;
  issues: ValidationIssue[];
  isValid: boolean;
  readableFieldCount: number;
  episodeCount: number;
  serverCount: number;
  sourceFormat: string;
  unmappedFields: string[];
  detectedName?: string;
}

/**
 * Tracking information of a file inside a job.
 */
export interface FileProgress {
  id: string;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  stage: ProcessingStage;
  progress: number;
  detectedName?: string;
  readableFieldCount: number;
  episodeCount: number;
  serverCount?: number;
  sourceFormat?: string;
  matchStatus?: MatchStatus;
  existingMovieId?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  parsed?: ParsedMovie;
}

/**
 * Aggregate counters of a job.
 */
export interface JobCounters {
  total: number;
  processed: number;
  success: number;
  failed: number;
  needsReview: number;
  skipped: number;
  cancelled: number;
  processing: number;
  imported: number;
  overallProgress: number;
}

/**
 * A single write performed against MongoDB.
 */
export interface ImportLogEntry {
  fileId: string;
  fileName: string;
  movieName: string;
  slug: string;
  movieId?: string;
  operation: ImportOperation;
  updatedFields: string[];
  status: ImportStatus;
  error?: string;
  timestamp: string;
}

/**
 * State of an import job.
 */
export interface ImportJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  cancelled: boolean;
  counters: JobCounters;
  files: FileProgress[];
  logs: ImportLogEntry[];
}

/**
 * Comparison of a single field.
 */
export interface FieldDiff {
  field: string;
  currentValue?: unknown;
  incomingValue?: unknown;
  status: FieldStatus;
  mergeStrategy?: MergeStrategy;
  message?: string;
  isProtected?: boolean;
}

/**
 * Comparison result of a movie.
 */
export interface MovieComparison {
  fileId: string;
  matchStatus: MatchStatus;
  matchedBy?: string;
  existing?: ExistingMovie;
  candidates: ExistingMovie[];
  diffs: FieldDiff[];
  updatableFields: string[];
}
