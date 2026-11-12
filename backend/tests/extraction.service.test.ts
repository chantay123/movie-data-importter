import { describe, expect, it } from 'vitest';
import {
  countExtractedEpisodes,
  detectSourceFormat,
  extractMovieData,
  extractMovieDataCandidates,
} from '../src/services/extraction.service';
import { SourceFormat } from '../src/types/extraction.types';
import {
  buildFlightPayload,
  buildFullFlightPayload,
  DOCTORX_MOVIE_DATA,
} from './fixtures/flightFixtures';

describe('extraction.service', () => {
  describe('detectSourceFormat', () => {
    it('detects a React Flight payload', () => {
      const payload = buildFlightPayload({ name: 'Phim' });

      expect(detectSourceFormat(payload)).toBe(SourceFormat.REACT_FLIGHT);
    });

    it('detects a plain JSON document', () => {
      expect(detectSourceFormat('{"name":"Phim"}')).toBe(SourceFormat.JSON_DOCUMENT);
    });

    it('detects an HTML page', () => {
      expect(detectSourceFormat('<!DOCTYPE html><html></html>')).toBe(SourceFormat.HTML);
    });

    it('detects an unknown payload', () => {
      expect(detectSourceFormat('   ')).toBe(SourceFormat.UNKNOWN);
    });
  });

  describe('extractMovieData', () => {
    it('extracts the main movie out of a Flight payload', () => {
      const result = extractMovieData(buildFullFlightPayload());

      expect(result.success).toBe(true);
      expect(result.format).toBe(SourceFormat.REACT_FLIGHT);
      expect(result.data?.name).toBe('Bác Sĩ X');
      expect(result.data?.slug).toBe('bac-si-x');
      expect(result.data?.originName).toBe('Doctor X: Mafia in White');
      expect(result.data?.status).toBe('ongoing');
      expect(result.data?.year).toBe(2026);
      expect(result.data?.time).toBe('66 phút/tập');
      expect(result.data?.episodeCurrent).toBe('Tập 10');
      expect(result.data?.episodeTotal).toBe('12');
      expect(result.data?.quality).toBe('FHD');
      expect(result.data?.view).toBe(79040);
      expect(result.data?.isChieuRap).toBe(false);
      expect(result.data?.trailerUrl).toBe('https://www.youtube.com/watch?v=v6KNnhkLnnY');
      expect(result.data?.thumbUrl).toContain('bac-si-x-thumb.webp');
      expect(result.data?.posterUrl).toContain('bac-si-x-poster.webp');
    });

    it('splits the comma separated actors into a list', () => {
      const result = extractMovieData(buildFullFlightPayload());

      expect(result.data?.actors).toHaveLength(15);
      expect(result.data?.actors?.[0]).toBe('Kim Ji-won');
      expect(result.data?.actors?.[1]).toBe('Lee Jung-eun');
      expect(result.data?.actors?.[2]).toBe('Son Hyun-joo');
    });

    it('extracts every server, language and episode', () => {
      const result = extractMovieData(buildFullFlightPayload());

      expect(result.data?.sources).toHaveLength(2);
      expect(result.data?.sources[0]?.serverName).toBe('KKPhim');
      expect(result.data?.sources[0]?.serverKey).toBe('kkphim');
      expect(result.data?.sources[0]?.languages).toHaveLength(1);
      expect(result.data?.sources[1]?.languages).toHaveLength(2);

      const counts = countExtractedEpisodes(result.data!);
      expect(counts.servers).toBe(2);
      expect(counts.episodes).toBe(4);
    });

    it('keeps the embed and the m3u8 links of every episode', () => {
      const result = extractMovieData(buildFullFlightPayload());
      const kkphim = result.data?.sources[0]?.languages[0]?.episodes[0];

      expect(kkphim?.linkEmbed).toContain('player.phimapi.com');
      expect(kkphim?.linkM3u8).toBe('https://a.kvp726.com/1/index.m3u8');
      expect(kkphim?.episodeNumber).toBe(1);
    });

    it('extracts the categories, the countries and the languages', () => {
      const result = extractMovieData(buildFullFlightPayload());

      expect(result.data?.categories?.map((entry) => entry.name)).toEqual([
        'Bí Ẩn',
        'Chính Kịch',
      ]);
      expect(result.data?.countries?.[0]?.name).toBe('Hàn Quốc');
      expect(result.data?.countries?.[0]?.slug).toBe('han-quoc');
      expect(result.data?.languages?.map((entry) => entry.name)).toEqual([
        'Vietsub',
        'Song Ngữ',
      ]);
    });

    it('extracts the TMDB identifiers of the movie', () => {
      const result = extractMovieData(buildFullFlightPayload());

      expect(result.data?.tmdb?.tmdbId).toBe('293610');
      expect(result.data?.tmdb?.type).toBe('tv');
      expect(result.data?.tmdb?.season).toBe(1);
    });

    it('extracts the cast of the standalone TMDB payload', () => {
      const result = extractMovieData(buildFullFlightPayload());

      expect(result.data?.cast).toHaveLength(2);
      expect(result.data?.cast?.[0]).toEqual({
        name: 'Kim Ji-won',
        character: 'Gye Su-jeong',
      });
    });

    it('reports the fields the Movie schema cannot store', () => {
      const result = extractMovieData(buildFullFlightPayload());

      expect(result.data?.unmappedFields).toContain('logoNameUrl');
      expect(result.data?.unmappedFields).not.toContain('name');
      expect(result.data?.unmappedFields).not.toContain('sources');
      expect(result.data?.unmappedFields).not.toContain('quality');
      expect(result.data?.unmappedFields).not.toContain('isChieuRap');
      expect(result.data?.unmappedFields).not.toContain('typeListId');
    });

    it('fails with a clear message when no movieData is present', () => {
      const result = extractMovieData('25:["$","div",null,{"children":"nothing here"}]');

      expect(result.success).toBe(false);
      expect(result.message).toContain('movieData');
    });

    it('fails with a clear message when the file is empty', () => {
      const result = extractMovieData('');

      expect(result.success).toBe(false);
      expect(result.message).toBe('The file is empty');
    });

    it('does not confuse a Flight reference with a movieData object', () => {
      const payload = buildFullFlightPayload();
      const candidates = extractMovieDataCandidates(payload);

      // The `"movieData":"$25:props:..."` reference must not be treated as a
      // candidate: only one real `movieData` object exists in the payload.
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.name).toBe('Bác Sĩ X');
    });
  });

  describe('the real doctorX fixture', () => {
    it('extracts the expected movie', () => {
      const content = buildFullFlightPayload(DOCTORX_MOVIE_DATA);
      const result = extractMovieData(content);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Bác Sĩ X');
      expect(result.data?.slug).toBe('bac-si-x');
    });
  });
});
