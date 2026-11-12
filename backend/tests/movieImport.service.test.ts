import { describe, expect, it } from 'vitest';
import { buildUpdateDocument, mergeManagedObject } from '../src/services/movieImport.service';
import { mapMovie } from '../src/services/movieMapper.service';
import { VALID_MOVIE_JSON } from './fixtures/movieFixtures';

describe('movieImport.service', () => {
  it('never writes a field that is missing from the source file', () => {
    const mapped = mapMovie({ name: 'Chỉ có tên', slug: 'chi-co-ten' });
    const { document } = buildUpdateDocument(
      mapped,
      { name: 'Chỉ có tên', slug: 'chi-co-ten' },
      { _id: '1', content: 'Nội dung cũ', actor: ['Diễn viên cũ'] },
      ['name', 'content', 'actor'],
    );

    expect(document['name']).toBe('Chỉ có tên');
    expect(document['content']).toBeUndefined();
    expect(document['actor']).toBeUndefined();
  });

  it('never writes a protected field', () => {
    const mapped = mapMovie({ name: 'Phim', slug: 'phim' });
    const { document, writtenFields } = buildUpdateDocument(
      mapped,
      { name: 'Phim', slug: 'phim' },
      undefined,
      ['name', 'viewCount'],
    );

    expect(document['viewCount']).toBeUndefined();
    expect(writtenFields).not.toContain('viewCount');
  });

  it('merges the episodes instead of replacing them', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const { document } = buildUpdateDocument(
      mapped,
      VALID_MOVIE_JSON,
      {
        _id: '1',
        episodes: [
          {
            server_name: 'Vietsub #1',
            server_data: [
              {
                name: '0',
                slug: 'tap-0',
                filename: 'tap-0',
                link_embed: 'https://old/0',
                link_m3u8: '',
              },
            ],
          },
        ],
      },
      ['episodes'],
    );

    const episodes = document['episodes'] as Array<{ server_data: unknown[] }>;

    expect(episodes).toHaveLength(2);
    expect(episodes[0]?.server_data).toHaveLength(3);
  });

  it('merges the arrays of actors', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const { document } = buildUpdateDocument(
      mapped,
      VALID_MOVIE_JSON,
      { _id: '1', actor: ['Nguyễn Văn A', 'Diễn viên cũ'] },
      ['actor'],
    );

    expect(document['actor']).toEqual(['Nguyễn Văn A', 'Diễn viên cũ', 'Trần Thị B']);
  });

  it('keeps the fields managed by the crawler inside the nested objects', () => {
    const merged = mergeManagedObject(
      {
        id: '12345',
        type: 'movie',
        season: null,
        vote_average: 8.2,
        vote_count: 900,
        trailer_url: '',
      },
      { id: '12345', type: 'movie' },
    );

    expect(merged['id']).toBe('12345');
    expect(merged['vote_average']).toBe(8.2);
    expect(merged['vote_count']).toBe(900);
    expect(merged['season']).toBeNull();
  });

  it('never writes a nested key that the source file does not carry', () => {
    const merged = mergeManagedObject(
      { key: 'abc', viewCount: 12 },
      { key: 'abc' },
    );

    expect(merged['key']).toBe('abc');
    expect(merged['viewCount']).toBe(12);
  });
});
