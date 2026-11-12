"use strict";
/**
 * Slug helpers used by the importer.
 *
 * The generated slug always matches the format produced by the shared
 * `slugify` utility of the crawler project (`a-z`, `0-9` and `-` only).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.buildUniqueSlug = buildUniqueSlug;
const MAX_SLUG_LENGTH = 200;
/**
 * Builds a URL friendly slug from an arbitrary text.
 *
 * The Vietnamese diacritics are removed, the text is lowercased and every
 * character that is not a letter, a digit or a dash is replaced by a dash.
 *
 * @param value - Raw text to convert.
 * @param fallback - Value returned when the input does not produce any slug.
 * @returns The generated slug.
 */
function slugify(value, fallback = '') {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return fallback;
    }
    const slug = value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, MAX_SLUG_LENGTH);
    return slug.length > 0 ? slug : fallback;
}
/**
 * Builds a unique slug by appending a numeric suffix when the slug is taken.
 *
 * @param base - Base slug (already normalized).
 * @param takenSlugs - Slugs that are already used by other documents.
 * @returns A slug that is not part of `takenSlugs`.
 */
function buildUniqueSlug(base, takenSlugs) {
    if (!takenSlugs.has(base)) {
        return base;
    }
    let suffix = 2;
    let candidate = `${base}-${suffix}`;
    while (takenSlugs.has(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }
    return candidate;
}
//# sourceMappingURL=normalizeSlug.js.map