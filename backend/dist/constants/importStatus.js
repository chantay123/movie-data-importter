"use strict";
/**
 * Shared enums describing the lifecycle of an import job and of every file it contains.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportOperation = exports.MergeStrategy = exports.FieldStatus = exports.MatchStatus = exports.ProcessingStage = exports.ImportStatus = void 0;
/**
 * Lifecycle status of a single imported file.
 */
var ImportStatus;
(function (ImportStatus) {
    /** The file is queued but has not been picked up yet. */
    ImportStatus["WAITING"] = "WAITING";
    /** The file is currently being parsed / compared / imported. */
    ImportStatus["PROCESSING"] = "PROCESSING";
    /** The file was processed and (when applicable) imported without error. */
    ImportStatus["SUCCESS"] = "SUCCESS";
    /** The file could not be processed because of an error. */
    ImportStatus["FAILED"] = "FAILED";
    /** The file was processed but requires a manual decision before importing. */
    ImportStatus["NEEDS_REVIEW"] = "NEEDS_REVIEW";
    /** The file was intentionally skipped (e.g. not a `.txt` file or a duplicate). */
    ImportStatus["SKIPPED"] = "SKIPPED";
    /** The processing of the file was cancelled by the user. */
    ImportStatus["CANCELLED"] = "CANCELLED";
})(ImportStatus || (exports.ImportStatus = ImportStatus = {}));
/**
 * Stage of the processing pipeline a file is currently in.
 */
var ProcessingStage;
(function (ProcessingStage) {
    /** Reading the raw text content of the file. */
    ProcessingStage["READING"] = "READING";
    /** Detecting the format of the payload and extracting the `movieData` object. */
    ProcessingStage["EXTRACTING"] = "EXTRACTING";
    /** Parsing the TXT payload into the intermediate JSON structure. */
    ProcessingStage["PARSING"] = "PARSING";
    /** Validating the parsed JSON structure. */
    ProcessingStage["VALIDATING"] = "VALIDATING";
    /** Mapping the JSON onto the MongoDB `Movie` schema. */
    ProcessingStage["MAPPING"] = "MAPPING";
    /** Looking the movie up inside MongoDB. */
    ProcessingStage["COMPARING_DATABASE"] = "COMPARING_DATABASE";
    /** Writing the document to MongoDB. */
    ProcessingStage["IMPORTING"] = "IMPORTING";
    /** The file reached its final state. */
    ProcessingStage["COMPLETED"] = "COMPLETED";
})(ProcessingStage || (exports.ProcessingStage = ProcessingStage = {}));
/**
 * Result of the database lookup for a single parsed movie.
 */
var MatchStatus;
(function (MatchStatus) {
    /** Exactly one matching document was found. */
    MatchStatus["MATCHED"] = "MATCHED";
    /** No matching document exists yet. */
    MatchStatus["NEW"] = "NEW";
    /** Several documents could match; the user has to pick one. */
    MatchStatus["AMBIGUOUS"] = "AMBIGUOUS";
    /** The lookup ran but produced no usable result. */
    MatchStatus["NOT_FOUND"] = "NOT_FOUND";
})(MatchStatus || (exports.MatchStatus = MatchStatus = {}));
/**
 * Per field comparison status between the database document and the incoming data.
 */
var FieldStatus;
(function (FieldStatus) {
    /** The database value and the new value are equivalent. */
    FieldStatus["UNCHANGED"] = "UNCHANGED";
    /** The new value differs from the database value. */
    FieldStatus["CHANGED"] = "CHANGED";
    /** The incoming payload does not contain this field at all. */
    FieldStatus["MISSING"] = "MISSING";
    /** The incoming value cannot be used (wrong type, out of range, ...). */
    FieldStatus["INVALID"] = "INVALID";
    /** The incoming value conflicts with the database value in a way that needs review. */
    FieldStatus["CONFLICT"] = "CONFLICT";
})(FieldStatus || (exports.FieldStatus = FieldStatus = {}));
/**
 * Strategy used to merge an array field between the database and the incoming payload.
 */
var MergeStrategy;
(function (MergeStrategy) {
    /** Replace the database array with the incoming one. */
    MergeStrategy["REPLACE"] = "REPLACE";
    /** Keep the database order and append the incoming entries that are not present yet. */
    MergeStrategy["UNION"] = "UNION";
})(MergeStrategy || (exports.MergeStrategy = MergeStrategy = {}));
/**
 * Type of the write performed against MongoDB.
 */
var ImportOperation;
(function (ImportOperation) {
    /** A brand new document was created. */
    ImportOperation["CREATE"] = "CREATE";
    /** An existing document was updated. */
    ImportOperation["UPDATE"] = "UPDATE";
    /** Nothing was written (dry run, skipped or unresolved ambiguity). */
    ImportOperation["NONE"] = "NONE";
})(ImportOperation || (exports.ImportOperation = ImportOperation = {}));
//# sourceMappingURL=importStatus.js.map