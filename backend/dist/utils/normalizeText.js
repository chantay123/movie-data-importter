"use strict";
/**
 * Text normalization helpers used when comparing movie titles.
 *
 * The normalization is intentionally lossy: it is only used to *compare* two
 * strings, never to rewrite the data that is stored in MongoDB.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripDiacritics = stripDiacritics;
exports.normalizeText = normalizeText;
exports.normalizeSlug = normalizeSlug;
exports.isSameText = isSameText;
exports.buildTextKeys = buildTextKeys;
/**
 * Removes the Vietnamese diacritics from a string and converts `đ` to `d`.
 *
 * @param value - Text to strip the diacritics from.
 * @returns The text without diacritics.
 */
function stripDiacritics(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
}
/**
 * Normalizes a movie title so two spellings of the same title compare equal.
 *
 * The normalization removes diacritics, lowercases the text, strips punctuation
 * and collapses whitespace.
 *
 * @param value - Raw title coming from the database or from a TXT file.
 * @returns The normalized comparison key, or an empty string for invalid input.
 */
function normalizeText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return stripDiacritics(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Normalizes a slug so two spellings of the same slug compare equal.
 *
 * @param value - Raw slug coming from the database or from a TXT file.
 * @returns The normalized slug, or an empty string for invalid input.
 */
function normalizeSlug(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return stripDiacritics(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}
/**
 * Checks whether two titles refer to the same movie.
 *
 * @param left - First title.
 * @param right - Second title.
 * @returns `true` when both normalized titles are equal and not empty.
 */
function isSameText(left, right) {
    const a = normalizeText(left);
    const b = normalizeText(right);
    return a.length > 0 && a === b;
}
/**
 * Builds a comparison key from a list of candidate names.
 *
 * @param names - Candidate titles to normalize.
 * @returns A list of unique, non empty normalized keys.
 */
function buildTextKeys(names) {
    const keys = new Set();
    for (const name of names) {
        const normalized = normalizeText(name);
        if (normalized.length > 0) {
            keys.add(normalized);
        }
    }
    return [...keys];
}
//# sourceMappingURL=normalizeText.js.map