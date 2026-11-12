import { describe, expect, it } from 'vitest';
import { buildTextKeys, isSameText, normalizeSlug, normalizeText } from '../src/utils/normalizeText';
import { buildUniqueSlug, slugify } from '../src/utils/normalizeSlug';
import { parseIsoDate, toIsoString, yearToReleaseDate } from '../src/utils/dateMapper';

describe('normalizeText', () => {
  it('removes the Vietnamese diacritics', () => {
    expect(normalizeText('Bác Sĩ X')).toBe('bac si x');
  });

  it('ignores the case', () => {
    expect(normalizeText('BAC SĨ X')).toBe(normalizeText('bác sĩ x'));
  });

  it('collapses the whitespace', () => {
    expect(normalizeText('  Bác    Sĩ   X  ')).toBe('bac si x');
  });

  it('removes the special characters', () => {
    expect(normalizeText('Bác Sĩ X: Phần 2!')).toBe('bac si x phan 2');
  });

  it('handles an empty value', () => {
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText('')).toBe('');
  });

  it('compares two titles', () => {
    expect(isSameText('Đảo Chính', 'dao chinh')).toBe(true);
    expect(isSameText('Đảo Chính', 'Đảo Chiều')).toBe(false);
    expect(isSameText('', '')).toBe(false);
  });

  it('builds the unique comparison keys', () => {
    expect(buildTextKeys(['Đảo Chính', 'dao chinh', 'Phim khác'])).toHaveLength(2);
  });
});

describe('normalizeSlug', () => {
  it('normalizes a slug', () => {
    expect(normalizeSlug('Bác Sĩ X')).toBe('bac-si-x');
    expect(normalizeSlug('dao--chinh')).toBe('dao-chinh');
  });
});

describe('slugify', () => {
  it('produces an ASCII slug', () => {
    expect(slugify('Bác Sĩ X')).toBe('bac-si-x');
    expect(slugify('Đặc Sắc')).toBe('dac-sac');
    expect(slugify('')).toBe('');
  });

  it('builds a unique slug', () => {
    const taken = new Set(['phim', 'phim-2']);

    expect(buildUniqueSlug('phim', taken)).toBe('phim-3');
    expect(buildUniqueSlug('moi', taken)).toBe('moi');
  });
});

describe('dateMapper', () => {
  it('converts a year into the first of January in UTC', () => {
    expect(yearToReleaseDate(2023)?.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    expect(yearToReleaseDate('2023')?.toISOString()).toBe('2023-01-01T00:00:00.000Z');
  });

  it('rejects an invalid year', () => {
    expect(yearToReleaseDate('abc')).toBeNull();
    expect(yearToReleaseDate(12)).toBeNull();
    expect(yearToReleaseDate(undefined)).toBeNull();
  });

  it('parses an ISO date', () => {
    expect(parseIsoDate('2023-05-04T00:00:00.000Z')?.toISOString()).toBe(
      '2023-05-04T00:00:00.000Z',
    );
    expect(parseIsoDate('not-a-date')).toBeNull();
  });

  it('serializes a date', () => {
    expect(toIsoString(new Date('2023-05-04T00:00:00.000Z'))).toBe('2023-05-04T00:00:00.000Z');
    expect(toIsoString(null)).toBeNull();
  });
});
