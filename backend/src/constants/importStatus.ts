/**
 * Shared enums describing the lifecycle of an import job and of every file it contains.
 */

/**
 * Lifecycle status of a single imported file.
 */
export enum ImportStatus {
  /** The file is queued but has not been picked up yet. */
  WAITING = 'WAITING',
  /** The file is currently being parsed / compared / imported. */
  PROCESSING = 'PROCESSING',
  /**
   * The file was parsed and compared with the database, but nothing was
   * written yet: the user still has to confirm the import.
   */
  PARSED = 'PARSED',
  /** The file was written into MongoDB. */
  SUCCESS = 'SUCCESS',
  /** The file could not be processed because of an error. */
  FAILED = 'FAILED',
  /** The file was processed but requires a manual decision before importing. */
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  /** The file was intentionally skipped (e.g. not a `.txt` file or a duplicate). */
  SKIPPED = 'SKIPPED',
  /** The processing of the file was cancelled by the user. */
  CANCELLED = 'CANCELLED',
}

/**
 * Reason why a file was skipped.
 */
export enum SkipReason {
  /**
   * The movie already exists in MongoDB and the incoming file does not bring
   * any change: the file is marked as "already there" and ignored.
   */
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  /**
   * Another file of the same job already targets the same movie: only the
   * first one is kept.
   */
  DUPLICATE_IN_BATCH = 'DUPLICATE_IN_BATCH',
  /** The file is not a `.txt` file and cannot be parsed. */
  NOT_A_TXT_FILE = 'NOT_A_TXT_FILE',
}

/**
 * Stage of the processing pipeline a file is currently in.
 */
export enum ProcessingStage {
  /** Reading the raw text content of the file. */
  READING = 'READING',
  /** Detecting the format of the payload and extracting the `movieData` object. */
  EXTRACTING = 'EXTRACTING',
  /** Parsing the TXT payload into the intermediate JSON structure. */
  PARSING = 'PARSING',
  /** Validating the parsed JSON structure. */
  VALIDATING = 'VALIDATING',
  /** Mapping the JSON onto the MongoDB `Movie` schema. */
  MAPPING = 'MAPPING',
  /** Looking the movie up inside MongoDB. */
  COMPARING_DATABASE = 'COMPARING_DATABASE',
  /** Writing the document to MongoDB. */
  IMPORTING = 'IMPORTING',
  /** The file reached its final state. */
  COMPLETED = 'COMPLETED',
}

/**
 * Result of the database lookup for a single parsed movie.
 */
export enum MatchStatus {
  /** Exactly one matching document was found. */
  MATCHED = 'MATCHED',
  /** No matching document exists yet. */
  NEW = 'NEW',
  /** Several documents could match; the user has to pick one. */
  AMBIGUOUS = 'AMBIGUOUS',
  /** The lookup ran but produced no usable result. */
  NOT_FOUND = 'NOT_FOUND',
}

/**
 * Per field comparison status between the database document and the incoming data.
 */
export enum FieldStatus {
  /** The database value and the new value are equivalent. */
  UNCHANGED = 'UNCHANGED',
  /** The new value differs from the database value. */
  CHANGED = 'CHANGED',
  /** The incoming payload does not contain this field at all. */
  MISSING = 'MISSING',
  /** The incoming value cannot be used (wrong type, out of range, ...). */
  INVALID = 'INVALID',
  /** The incoming value conflicts with the database value in a way that needs review. */
  CONFLICT = 'CONFLICT',
}

/**
 * Strategy used to merge an array field between the database and the incoming payload.
 */
export enum MergeStrategy {
  /** Replace the database array with the incoming one. */
  REPLACE = 'REPLACE',
  /** Keep the database order and append the incoming entries that are not present yet. */
  UNION = 'UNION',
}

/**
 * Type of the write performed against MongoDB.
 */
export enum ImportOperation {
  /** A brand new document was created. */
  CREATE = 'CREATE',
  /** An existing document was updated. */
  UPDATE = 'UPDATE',
  /** Nothing was written (dry run, skipped or unresolved ambiguity). */
  NONE = 'NONE',
}
