/**
 * Mirrors of the backend enums and DTOs used by the admin panel.
 */

/**
 * Lifecycle status of a single imported file.
 */
export enum ImportStatus {
  WAITING = 'WAITING',
  PROCESSING = 'PROCESSING',
  /** The file was parsed and compared, but nothing was written yet. */
  PARSED = 'PARSED',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  SKIPPED = 'SKIPPED',
  CANCELLED = 'CANCELLED',
}

/**
 * Stage of the processing pipeline a file is currently in.
 */
export enum ProcessingStage {
  READING = 'READING',
  EXTRACTING = 'EXTRACTING',
  PARSING = 'PARSING',
  VALIDATING = 'VALIDATING',
  MAPPING = 'MAPPING',
  COMPARING_DATABASE = 'COMPARING_DATABASE',
  IMPORTING = 'IMPORTING',
  COMPLETED = 'COMPLETED',
}

/**
 * Result of the database lookup for a single parsed movie.
 */
export enum MatchStatus {
  MATCHED = 'MATCHED',
  NEW = 'NEW',
  AMBIGUOUS = 'AMBIGUOUS',
  NOT_FOUND = 'NOT_FOUND',
}

/**
 * Per field comparison status.
 */
export enum FieldStatus {
  UNCHANGED = 'UNCHANGED',
  CHANGED = 'CHANGED',
  MISSING = 'MISSING',
  INVALID = 'INVALID',
  CONFLICT = 'CONFLICT',
}

/**
 * Merge strategy of a field.
 */
export enum MergeStrategy {
  REPLACE = 'REPLACE',
  UNION = 'UNION',
}

/**
 * Type of the write performed against MongoDB.
 */
export enum ImportOperation {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  NONE = 'NONE',
}

/**
 * Reason why a file was skipped.
 */
export enum SkipReason {
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  DUPLICATE_IN_BATCH = 'DUPLICATE_IN_BATCH',
  NOT_A_TXT_FILE = 'NOT_A_TXT_FILE',
}
