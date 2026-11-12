import { describe, expect, it } from 'vitest';
import {
  countEpisodes,
  countReadableFields,
  parseJsonPayload,
  parseMovieFile,
} from '../src/services/textParser.service';
import {
  buildTxtContent,
  MINIMAL_MOVIE_JSON,
  MISSING_NAME_JSON,
  MOVIE_WITH_DUPLICATE_EPISODES_JSON,
  UNICODE_MOVIE_JSON,
  VALID_MOVIE_JSON,
} from './fixtures/movieFixtures';

describe('textParser.service', () => {
  it('parses a valid TXT file', () => {
    const content = buildTxtContent(VALID_MOVIE_JSON);
    const result = parseMovieFile('bac-si-x.txt', content.length, content);

    expect(result.raw).toBeDefined();
    expect(result.mapped?.name).toBe('Bác Sĩ X');
    expect(result.mapped?.slug).toBe('bac-si-x');
    expect(result.isValid).toBe(true);
    expect(result.detectedName).toBe('Bác Sĩ X');
    expect(result.episodeCount).toBe(3);
  });

  it('parses a JSON payload embedded in a TXT file', () => {
    const content = `Dữ liệu phim sau:\n${buildTxtContent(MINIMAL_MOVIE_JSON)}\nHết file.`;
    const raw = parseJsonPayload(content);

    expect(raw).not.toBeNull();
    expect(raw?.name).toBe('Phim Tối Giản');
  });

  it('fails on a malformed file', () => {
    const result = parseMovieFile('broken.txt', 20, 'this is not json at all');

    expect(result.raw).toBeUndefined();
    expect(result.isValid).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.issues[0]?.severity).toBe('error');
  });

  it('fails when the movie has no name', () => {
    const content = buildTxtContent(MISSING_NAME_JSON);
    const result = parseMovieFile('no-name.txt', content.length, content);

    expect(result.isValid).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'name')).toBe(true);
  });

  it('handles Vietnamese and unicode characters', () => {
    const content = buildTxtContent(UNICODE_MOVIE_JSON);
    const result = parseMovieFile('unicode.txt', content.length, content);

    expect(result.mapped?.name).toBe('Đảo Chính: Đặc Sắc 🎬');
    expect(result.mapped?.actor).toEqual(['Nguyễn Hoàng Ái']);
    expect(result.readableFieldCount).toBeGreaterThan(0);
  });

  it('counts every episode of every server', () => {
    const content = buildTxtContent(VALID_MOVIE_JSON);
    const raw = parseJsonPayload(content);

    expect(countEpisodes(raw!)).toBe(3);
  });

  it('counts the readable fields', () => {
    const content = buildTxtContent(VALID_MOVIE_JSON);
    const raw = parseJsonPayload(content);

    expect(countReadableFields(raw!)).toBeGreaterThan(10);
  });

  it('removes the duplicated episodes of a server', () => {
    const content = buildTxtContent(MOVIE_WITH_DUPLICATE_EPISODES_JSON);
    const result = parseMovieFile('dup.txt', content.length, content);

    expect(result.mapped?.episodes?.[0]?.server_data).toHaveLength(2);
    expect(result.mapped?.episodes?.[0]?.server_data[0]?.link_embed).toBe('https://a/1');
  });
});
