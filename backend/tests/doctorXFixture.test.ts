import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportStatus } from '../src/constants/importStatus';
import { parseMovieFile } from '../src/services/textParser.service';
import { SourceFormat } from '../src/types/extraction.types';

/**
 * Absolute path of the folder holding the real TXT fixtures.
 */
const SAMPLES_DIR = path.resolve(__dirname, '..', 'data', 'samples');

/**
 * Path of the real React Flight payload exported from the detail page of
 * `Bác Sĩ X`.
 */
const DOCTORX_FIXTURE = path.join(SAMPLES_DIR, 'doctorX.txt');

/**
 * Reads a fixture file.
 *
 * @param filePath - Path of the file.
 * @returns The content of the file.
 */
function readFixture(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

describe('the real doctorX(1).txt fixture', () => {
  it('is present in the samples folder', () => {
    expect(fs.existsSync(DOCTORX_FIXTURE)).toBe(true);
  });

  it('is parsed without any error', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.status).toBe(ImportStatus.SUCCESS);
    expect(result.isValid).toBe(true);
  });

  it('is detected as a React Flight payload', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.sourceFormat).toBe(SourceFormat.REACT_FLIGHT);
  });

  it('extracts the main movie', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.name).toBe('Bác Sĩ X');
    expect(result.mapped?.slug).toBe('bac-si-x');
    expect(result.mapped?.originName).toBe('Doctor X: Mafia in White');
    expect(result.detectedName).toBe('Bác Sĩ X');
  });

  it('recovers the encoding of every field', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.time).toBe('66 phút/tập');
    expect(result.mapped?.episodeCurrent).toBe('Tập 10');
    expect(result.mapped?.categories?.map((entry) => entry.name)).toEqual([
      'Bí Ẩn',
      'Chính Kịch',
      'Hình Sự',
      'Tâm Lý',
    ]);
    expect(result.mapped?.countries?.[0]?.name).toBe('Hàn Quốc');
    expect(result.mapped?.lang).toBe('Vietsub + Song Ngữ');
  });

  it('extracts the actors', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.actor?.[0]).toBe('Kim Ji-won');
    expect(result.mapped?.actor).toHaveLength(15);
  });

  it('does not treat the placeholder director as a real one', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.director).toBeUndefined();
  });

  it('extracts the TMDB identifiers and the trailer', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.tmdb?.id).toBe('293610');
    expect(result.mapped?.tmdb?.type).toBe('tv');
    expect(result.mapped?.tmdb?.season).toBe(1);
    expect(result.mapped?.trailer?.key).toBe('v6KNnhkLnnY');
  });

  it('extracts every server with its languages and its episodes', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);
    const episodes = result.mapped?.episodes ?? [];

    // The production documents only carry the episodes of the server the movie
    // was crawled from (`nguonc`), named after the language they carry.
    expect(episodes.map((server) => server.server_name)).toEqual([
      'Vietsub #1',
      'Thuyết minh #1',
    ]);

    // The raw payload carries 5 servers, 7 language groups and 64 episodes.
    expect(result.episodeCount).toBe(20);
  });

  it('keeps the embed and the m3u8 links', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);
    const nguonc = result.mapped?.episodes?.[0];

    expect(nguonc?.server_data).toHaveLength(10);
    expect(nguonc?.server_data[0]?.link_embed).toContain('embed12.streamc.xyz');
    expect(nguonc?.server_data[0]?.slug).toBe('tap-1');
  });

  it('does not import the movies of the sidebar', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.name).toBe('Bác Sĩ X');
    expect(result.mapped?.slug).not.toBe('phim-de-xuat');
  });

  it('maps the fields of the Movie schema that the payload carries', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);
    const mapped = result.mapped;

    // The `source` field is deduced from the `serverKey` of the servers.
    // The production documents are all crawled from `nguonc`.
    expect(mapped?.source).toBe('nguonc');
    // The `type` enum is deduced from the format group (`Phim Bộ`).
    expect(mapped?.type).toBe('series');
    expect(mapped?.availabilityStatus).toBe('released');
    expect(mapped?.chieurap).toBe(false);
    // The format group lives in the master data, not on the document.
    expect(mapped?.quality).toBe('Phim bộ');
    expect(mapped?.year).toBe(2026);
  });

  it('stores the search keys of the titles', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.name_normalized).toBe('bac si x');
    expect(result.mapped?.originName_normalized).toBe('doctor x: mafia in white');
  });

  it('keeps the original nguonc image URLs', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.originalPosterUrl).toContain('img.nguonc.com');
    expect(result.mapped?.originalThumbUrl).toContain('img.nguonc.com');
  });

  it('stores a plain text summary, like the existing documents', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.content).not.toMatch(/<[a-z]/i);
    expect(result.mapped?.content).toContain('bệnh viện');
  });

  it('builds an absolute URL for the TMDB backdrop', () => {
    const content = readFixture(DOCTORX_FIXTURE);
    const result = parseMovieFile('doctorX(1).txt', content.length, content);

    expect(result.mapped?.backdropUrl).toMatch(/^https:\/\/image\.tmdb\.org\//);
  });
});
