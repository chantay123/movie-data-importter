import { describe, expect, it } from 'vitest';
import { extractYoutubeKey, mapMovie, mapTrailer, toMovieDocument } from '../src/services/movieMapper.service';
import {
  MOVIE_WITH_TRAILER_JSON,
  MOVIE_WITH_TRAILER_KEY_JSON,
  MOVIE_WITHOUT_TRAILER_JSON,
  UNICODE_MOVIE_JSON,
  VALID_MOVIE_JSON,
} from './fixtures/movieFixtures';

describe('movieMapper.service', () => {
  it('maps the payload onto the Movie schema', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    expect(mapped.name).toBe('Bác Sĩ X');
    expect(mapped.originName).toBe('Doctor X');
    expect(mapped.sourceId).toBe('ophim-abc123');
    expect(mapped.actor).toEqual(['Nguyễn Văn A', 'Trần Thị B']);
    expect(mapped.director).toEqual(['Đạo diễn C']);
    expect(mapped.time).toBe('45 phút/tập');
    expect(mapped.episodeCurrent).toBe('10');
    expect(mapped.episodeTotal).toBe('12');
    expect(mapped.lang).toBe('Vietsub');
    expect(mapped.thumbUrl).toBe('https://img.example.com/bac-si-x-thumb.jpg');
    expect(mapped.posterUrl).toBe('https://img.example.com/bac-si-x-poster.jpg');
    expect(mapped.tmdb).toEqual({ id: '12345', type: 'tv', season: 1 });
    expect(mapped.episodes).toHaveLength(2);
    expect(mapped.episodes?.[0]?.server_name).toBe('Vietsub #1');
    expect(mapped.episodes?.[0]?.server_data[0]).toEqual({
      name: '1',
      slug: 'tap-1',
      filename: 'tap-1',
      link_embed: 'https://example.com/embed/episode-1',
      link_m3u8: '',
    });
  });

  it('omits the fields that are not present in the payload', () => {
    const mapped = mapMovie({
      name: 'Chỉ có tên',
      slug: 'chi-co-ten',
    });

    expect(mapped.content).toBeUndefined();
    expect(mapped.actor).toBeUndefined();
    expect(mapped.director).toBeUndefined();
    expect(mapped.episodes).toBeUndefined();
    expect(mapped.trailer).toBeUndefined();
    expect(mapped.tmdb).toBeUndefined();
    expect(mapped.releaseDate).toBeUndefined();
  });

  it('converts a year into the first day of January in UTC', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const document = toMovieDocument(mapped, VALID_MOVIE_JSON);

    expect(document['releaseDate']).toBeInstanceOf(Date);
    expect((document['releaseDate'] as Date).toISOString()).toBe('2023-01-01T00:00:00.000Z');
  });

  it('does not create a release date when the year is missing', () => {
    const mapped = mapMovie({ name: 'Không năm', slug: 'khong-nam' });
    const document = toMovieDocument(mapped, { name: 'Không năm', slug: 'khong-nam' });

    expect(document['releaseDate']).toBeUndefined();
  });

  it('extracts the YouTube key from a trailer URL', () => {
    expect(extractYoutubeKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeKey('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeKey('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeKey('https://example.com/video')).toBeUndefined();
  });

  it('creates a trailer when the payload provides a valid URL', () => {
    const mapped = mapMovie(MOVIE_WITH_TRAILER_JSON);

    expect(mapped.trailer).toBeDefined();
    expect(mapped.trailer?.key).toBe('dQw4w9WgXcQ');
    expect(mapped.trailer?.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(mapped.trailer?.name).toBeUndefined();
    expect(mapped.trailer?.publishedAt).toBeUndefined();
    expect(mapped.trailer?.official).toBeUndefined();
  });

  it('creates a trailer from a key only', () => {
    const mapped = mapMovie(MOVIE_WITH_TRAILER_KEY_JSON);

    expect(mapped.trailer?.key).toBe('abc123XYZ_-');
    expect(mapped.trailer?.url).toBe('https://www.youtube.com/watch?v=abc123XYZ_-');
  });

  it('does not create a trailer when the payload has none', () => {
    const mapped = mapMovie(MOVIE_WITHOUT_TRAILER_JSON);

    expect(mapped.trailer).toBeUndefined();
  });

  it('does not create a trailer from an invalid URL', () => {
    const trailer = mapTrailer({ url: 'not-a-url' });

    expect(trailer).toBeUndefined();
  });

  it('maps the categories and the countries', () => {
    const mapped = mapMovie(UNICODE_MOVIE_JSON);

    expect(mapped.categories).toEqual([{ name: 'Hài', slug: '' }]);
  });
});
