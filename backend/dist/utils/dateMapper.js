"use strict";
/**
 * Date helpers used when mapping the release date of a movie.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.yearToReleaseDate = yearToReleaseDate;
exports.parseIsoDate = parseIsoDate;
exports.toIsoString = toIsoString;
/**
 * Converts a year into the first day of that year, expressed in UTC.
 *
 * The importer never invents a month or a day that is not present in the
 * source data: when only a year is known, the 1st of January is used.
 *
 * @param year - Year to convert.
 * @returns The corresponding UTC date, or `null` when the year is invalid.
 */
function yearToReleaseDate(year) {
    if (year === null || year === undefined || year === '') {
        return null;
    }
    const numericYear = typeof year === 'number' ? year : Number.parseInt(String(year), 10);
    if (!Number.isInteger(numericYear) || numericYear < 1000 || numericYear > 3000) {
        return null;
    }
    return new Date(Date.UTC(numericYear, 0, 1));
}
/**
 * Converts a full date coming from the source payload into a `Date`.
 *
 * Only ISO-like strings and epoch milliseconds are accepted; ambiguous
 * formats are rejected instead of being guessed.
 *
 * @param value - Raw date value.
 * @returns The parsed date, or `null` when the value cannot be parsed safely.
 */
function parseIsoDate(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (typeof value === 'number') {
        const fromEpoch = new Date(value);
        return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
}
/**
 * Serializes a date into an ISO 8601 string.
 *
 * @param value - Date to serialize.
 * @returns The ISO representation, or `null` when the value is not a valid date.
 */
function toIsoString(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
//# sourceMappingURL=dateMapper.js.map