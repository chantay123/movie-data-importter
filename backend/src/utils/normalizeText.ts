/**
 * Text normalization helpers used when comparing movie titles.
 *
 * The normalization is intentionally lossy: it is only used to *compare* two
 * strings, never to rewrite the data that is stored in MongoDB.
 */

/**
 * Removes the Vietnamese diacritics from a string and converts `đ` to `d`.
 *
 * @param value - Text to strip the diacritics from.
 * @returns The text without diacritics.
 */
export function stripDiacritics(value: string): string {
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
export function normalizeText(value: string | null | undefined): string {
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
export function normalizeSlug(value: string | null | undefined): string {
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
 * Builds the search key of a title.
 *
 * The production documents store a `name_normalized` and an
 * `originName_normalized` field next to the title. They are used by the search
 * endpoint of the backend to match a query against a movie.
 *
 * The key only removes the diacritics and lowercases the text: the
 * punctuation is kept, so that `Sasaki Và Pii-chan (Phần 2)` becomes
 * `sasaki va pii-chan (phan 2)`.
 *
 * @param value - Raw title coming from the database or from a TXT file.
 * @returns The search key, or an empty string for invalid input.
 */
export function buildSearchKey(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  return stripDiacritics(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether two titles refer to the same movie.
 *
 * @param left - First title.
 * @param right - Second title.
 * @returns `true` when both normalized titles are equal and not empty.
 */
export function isSameText(left: string | null | undefined, right: string | null | undefined): boolean {
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
export function buildTextKeys(names: Array<string | null | undefined>): string[] {
  const keys = new Set<string>();

  for (const name of names) {
    const normalized = normalizeText(name);
    if (normalized.length > 0) {
      keys.add(normalized);
    }
  }

  return [...keys];
}
