import { describe, expect, it } from 'vitest';
import { hasBlockingIssue, validateMovie } from '../src/services/jsonValidator.service';
import { mapMovie } from '../src/services/movieMapper.service';
import { VALID_MOVIE_JSON } from './fixtures/movieFixtures';

describe('jsonValidator.service', () => {
  it('accepts a valid movie', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const issues = validateMovie(VALID_MOVIE_JSON, mapped);

    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('rejects a movie without a name', () => {
    const raw = { slug: 'khong-co-ten' };
    const mapped = mapMovie(raw);
    const issues = validateMovie(raw, mapped);

    expect(hasBlockingIssue(issues)).toBe(true);
    expect(issues.some((issue) => issue.field === 'name')).toBe(true);
  });

  it('warns about an invalid year', () => {
    const raw = { name: 'Phim', slug: 'phim', info: { year: 'khong-phai-nam' } };
    const mapped = mapMovie(raw);
    const issues = validateMovie(raw, mapped);

    expect(issues.some((issue) => issue.field === 'info.year')).toBe(true);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it('warns about an episode without a playable link', () => {
    const raw = {
      name: 'Phim',
      slug: 'phim',
      sources: [
        {
          server_name: 'Vietsub #1',
          server_data: [{ name: '1', slug: 'tap-1', filename: 'tap-1' }],
        },
      ],
    };
    const mapped = mapMovie(raw);
    const issues = validateMovie(raw, mapped);

    expect(issues.some((issue) => issue.field === 'sources')).toBe(true);
  });
});
