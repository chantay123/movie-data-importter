import { describe, expect, it } from 'vitest';
import { FieldStatus, MergeStrategy } from '../src/constants/importStatus';
import {
  buildComparison,
  diffMovie,
  mergeEpisodes,
  mergeStringArray,
} from '../src/services/movieDiff.service';
import { mapMovie } from '../src/services/movieMapper.service';
import { VALID_MOVIE_JSON } from './fixtures/movieFixtures';

describe('movieDiff.service', () => {
  it('marks the missing fields as MISSING', () => {
    const mapped = mapMovie({ name: 'Chỉ có tên', slug: 'chi-co-ten' });
    const diffs = diffMovie(mapped, {
      _id: '1',
      name: 'Tên cũ',
      content: 'Nội dung cũ',
    });

    const content = diffs.find((diff) => diff.field === 'content');
    expect(content?.status).toBe(FieldStatus.MISSING);
  });

  it('marks the identical fields as UNCHANGED', () => {
    const mapped = mapMovie({ name: 'Bác Sĩ X', slug: 'bac-si-x' });
    const diffs = diffMovie(mapped, { _id: '1', name: 'Bác Sĩ X' });

    const name = diffs.find((diff) => diff.field === 'name');
    expect(name?.status).toBe(FieldStatus.UNCHANGED);
  });

  it('marks the different fields as CHANGED', () => {
    const mapped = mapMovie({ name: 'Bác Sĩ X mới', slug: 'bac-si-x' });
    const diffs = diffMovie(mapped, { _id: '1', name: 'Bác Sĩ X' });

    const name = diffs.find((diff) => diff.field === 'name');
    expect(name?.status).toBe(FieldStatus.CHANGED);
  });

  it('never writes the protected fields', () => {
    const mapped = mapMovie({ name: 'Phim', slug: 'phim' });
    const diffs = diffMovie(mapped, { _id: '1', name: 'Phim' });

    const viewCount = diffs.find((diff) => diff.field === 'viewCount');
    expect(viewCount?.isProtected).toBe(true);
  });

  it('uses the union strategy for the array fields', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const diffs = diffMovie(mapped, { _id: '1', actor: ['Nguyễn Văn A'] });

    const actor = diffs.find((diff) => diff.field === 'actor');
    expect(actor?.mergeStrategy).toBe(MergeStrategy.UNION);
  });

  it('only lists the updatable fields', () => {
    const mapped = mapMovie({ name: 'Tên mới', slug: 'ten-moi' });
    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: { _id: '1', name: 'Tên cũ' },
      candidates: [],
    });

    expect(comparison.updatableFields).toContain('name');
    expect(comparison.updatableFields).not.toContain('content');
  });

  it('merges the episodes without creating duplicates', () => {
    const existing = [
      {
        server_name: 'Vietsub #1',
        server_data: [
          { name: '1', slug: 'tap-1', filename: 'tap-1', link_embed: 'https://old/1', link_m3u8: '' },
        ],
      },
    ];

    const incoming = [
      {
        server_name: 'Vietsub #1',
        server_data: [
          { name: '1', slug: 'tap-1', filename: 'tap-1', link_embed: 'https://new/1', link_m3u8: '' },
          { name: '2', slug: 'tap-2', filename: 'tap-2', link_embed: 'https://new/2', link_m3u8: '' },
        ],
      },
    ];

    const merged = mergeEpisodes(existing, incoming);

    expect(merged.added).toBe(1);
    expect(merged.updated).toBe(1);
    expect(merged.episodes[0]?.server_data).toHaveLength(2);
    expect(merged.episodes[0]?.server_data[0]?.link_embed).toBe('https://new/1');
  });

  it('never removes an episode during the merge', () => {
    const existing = [
      {
        server_name: 'Vietsub #1',
        server_data: [
          { name: '1', slug: 'tap-1', filename: 'tap-1', link_embed: 'https://old/1', link_m3u8: '' },
          { name: '2', slug: 'tap-2', filename: 'tap-2', link_embed: 'https://old/2', link_m3u8: '' },
        ],
      },
    ];

    const merged = mergeEpisodes(existing, [
      {
        server_name: 'Vietsub #1',
        server_data: [
          { name: '1', slug: 'tap-1', filename: 'tap-1', link_embed: 'https://new/1', link_m3u8: '' },
        ],
      },
    ]);

    expect(merged.episodes[0]?.server_data).toHaveLength(2);
  });

  it('merges the arrays of strings without duplicates', () => {
    const merged = mergeStringArray(['Nguyễn Văn A'], ['nguyen van a', 'Trần Thị B']);

    expect(merged).toEqual(['Nguyễn Văn A', 'Trần Thị B']);
  });

  it('does not report a change when only the crawler fields differ', () => {
    const mapped = mapMovie({
      name: 'Phim',
      slug: 'phim',
      info: { tmdb: { id: '12345', type: 'movie' } },
      trailer: { key: 'abc123' },
    });

    const diffs = diffMovie(mapped, {
      _id: '1',
      name: 'Phim',
      tmdb: { id: '12345', type: 'movie', season: null, vote_average: 8.2, vote_count: 900 },
      trailer: { key: 'abc123', url: 'https://www.youtube.com/watch?v=abc123', viewCount: 120, site: 'YouTube' },
    });

    const tmdb = diffs.find((diff) => diff.field === 'tmdb');
    const trailer = diffs.find((diff) => diff.field === 'trailer');

    expect(tmdb?.status).toBe(FieldStatus.UNCHANGED);
    expect(trailer?.status).toBe(FieldStatus.UNCHANGED);
  });

  it('reports a change when a managed key of a nested object differs', () => {
    const mapped = mapMovie({
      name: 'Phim',
      slug: 'phim',
      info: { tmdb: { id: '12345', type: 'tv' } },
    });

    const diffs = diffMovie(mapped, {
      _id: '1',
      tmdb: { id: '12345', type: 'movie' },
    });

    const tmdb = diffs.find((diff) => diff.field === 'tmdb');
    expect(tmdb?.status).toBe(FieldStatus.CHANGED);
  });

  it('offers every valid field when the movie does not exist yet', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const comparison = buildComparison('file-1', mapped, {
      status: 'NEW',
      candidates: [],
    });

    expect(comparison.updatableFields).toContain('name');
    expect(comparison.updatableFields).toContain('content');
    expect(comparison.updatableFields).toContain('actor');
    expect(comparison.updatableFields).toContain('episodes');
    expect(comparison.updatableFields).not.toContain('viewCount');
  });
});
