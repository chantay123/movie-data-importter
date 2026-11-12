import { describe, expect, it } from 'vitest';
import {
  buildServerGroupName,
  mapExtractedMovie,
  mapFormatName,
  pickSourceServers,
  toEpisodeServers,
} from '../src/services/movieMapper.service';
import { extractMovieData } from '../src/services/extraction.service';
import { buildFullFlightPayload } from './fixtures/flightFixtures';

describe('movieMapper.service - extracted movies', () => {
  describe('buildServerGroupName', () => {
    it('combines the server name and the language name', () => {
      expect(buildServerGroupName('KKPhim', 'Vietsub')).toBe('KKPhim - Vietsub');
    });

    it('keeps the server name when it already carries the language', () => {
      expect(buildServerGroupName('Vietsub #1', 'Vietsub #1')).toBe('Vietsub #1');
    });

    it('returns the server name when the language is missing', () => {
      expect(buildServerGroupName('KKPhim', undefined)).toBe('KKPhim');
    });

    it('collapses the whitespace of the labels', () => {
      expect(buildServerGroupName('VSPhim', 'Vietsub\n      #1')).toBe('VSPhim - Vietsub #1');
    });
  });

  describe('toEpisodeServers', () => {
    it('creates one group per language', () => {
      const servers = toEpisodeServers([
        {
          serverName: 'NguonC',
          serverKey: 'nguonc',
          languages: [
            {
              name: 'Vietsub #1',
              slug: 'vietsub-1',
              episodes: [{ name: 'Tập 1', slug: 'tap-1' }],
            },
            {
              name: 'Thuyết minh #1',
              slug: 'thuyet-minh-1',
              episodes: [{ name: 'Tập 1', slug: 'tap-1' }],
            },
          ],
        },
      ]);

      expect(servers).toHaveLength(2);
      expect(servers[0]?.server_name).toBe('Vietsub #1');
      expect(servers[1]?.server_name).toBe('Thuyết minh #1');
    });

    it('keeps the plain language name when the server exposes a single language', () => {
      const servers = toEpisodeServers([
        {
          serverName: 'KKPhim',
          serverKey: 'kkphim',
          languages: [
            { name: 'Vietsub', episodes: [{ name: 'Tập 1', slug: 'tap-1' }] },
          ],
        },
      ]);

      expect(servers[0]?.server_name).toBe('Vietsub');
    });

    it('never merges the episodes of two languages', () => {
      const servers = toEpisodeServers([
        {
          serverName: 'OnFlix',
          languages: [
            { name: 'Vietsub', episodes: [{ name: 'Tập 1', slug: 'tap-1' }] },
            { name: 'Thuyết Minh', episodes: [{ name: 'Tập 1', slug: 'tap-1' }] },
          ],
        },
      ]);

      expect(servers[0]?.server_data).toHaveLength(1);
      expect(servers[1]?.server_data).toHaveLength(1);
    });

    it('removes the duplicated episodes of a group', () => {
      const servers = toEpisodeServers([
        {
          serverName: 'KKPhim',
          languages: [
            {
              name: 'Vietsub',
              episodes: [
                { name: 'Tập 1', slug: 'tap-1' },
                { name: 'Tập 1', slug: 'tap-1' },
              ],
            },
          ],
        },
      ]);

      expect(servers[0]?.server_data).toHaveLength(1);
    });

    it('skips an episode without a name and without a slug', () => {
      const servers = toEpisodeServers([
        {
          serverName: 'KKPhim',
          languages: [{ name: 'Vietsub', episodes: [{ linkEmbed: 'https://a/1' }] }],
        },
      ]);

      expect(servers[0]?.server_data).toHaveLength(0);
    });
  });

  describe('mapFormatName', () => {
    it('normalizes the name of a format group', () => {
      expect(mapFormatName([{ name: 'Phim Bộ' }])).toBe('Phim bộ');
      expect(mapFormatName([{ name: 'Phim Lẻ' }])).toBe('Phim lẻ');
    });

    it('keeps the casing of the TV shows group', () => {
      expect(mapFormatName([{ name: 'TV Shows' }])).toBe('TV shows');
    });

    it('ignores an unknown format group', () => {
      expect(mapFormatName([{ name: 'Documentary' }])).toBeUndefined();
      expect(mapFormatName(undefined)).toBeUndefined();
    });
  });

  describe('pickSourceServers', () => {
    it('keeps only the servers of the crawling source', () => {
      const servers = pickSourceServers({
        sourceKey: 'nguonc',
        sources: [
          { serverName: 'KKPhim', serverKey: 'kkphim', languages: [] },
          { serverName: 'NguonC', serverKey: 'nguonc', languages: [] },
          { serverName: 'OnFlix', serverKey: 'onflix', languages: [] },
        ],
      });

      expect(servers.map((server) => server.serverName)).toEqual(['NguonC']);
    });

    it('keeps every server when the source is unknown', () => {
      const servers = pickSourceServers({
        sources: [
          { serverName: 'KKPhim', serverKey: 'kkphim', languages: [] },
          { serverName: 'OnFlix', serverKey: 'onflix', languages: [] },
        ],
      });

      expect(servers).toHaveLength(2);
    });
  });

  describe('mapExtractedMovie', () => {
    it('maps the extracted movie onto the Movie schema', () => {
      const extraction = extractMovieData(buildFullFlightPayload());
      const mapped = mapExtractedMovie(extraction.data!);

      expect(mapped.name).toBe('Bác Sĩ X');
      expect(mapped.slug).toBe('bac-si-x');
      expect(mapped.originName).toBe('Doctor X: Mafia in White');
      // The production documents use the slug as the source identifier.
      expect(mapped.sourceId).toBe('bac-si-x');
      expect(mapped.releaseDate?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(mapped.status).toBe('ongoing');
      expect(mapped.time).toBe('66 phút/tập');
      expect(mapped.episodeCurrent).toBe('Tập 10');
      expect(mapped.episodeTotal).toBe('12');
      expect(mapped.lang).toBe('Vietsub + Song Ngữ');
      expect(mapped.actor).toHaveLength(15);
      expect(mapped.trailer?.key).toBe('v6KNnhkLnnY');
      expect(mapped.tmdb?.id).toBe('293610');
      expect(mapped.tmdb?.type).toBe('tv');
      expect(mapped.tmdb?.season).toBe(1);
    });

    it('stores the search keys of the titles', () => {
      const extraction = extractMovieData(buildFullFlightPayload());
      const mapped = mapExtractedMovie(extraction.data!);

      expect(mapped.name_normalized).toBe('bac si x');
      expect(mapped.originName_normalized).toBe('doctor x: mafia in white');
    });

    it('keeps the original nguonc image URLs', () => {
      const extraction = extractMovieData(buildFullFlightPayload());
      const mapped = mapExtractedMovie(extraction.data!);

      expect(mapped.originalPosterUrl).toBe('https://img.nguonc.com/images/poster.webp');
      expect(mapped.originalThumbUrl).toBe('https://img.nguonc.com/images/thumb.webp');
    });

    it('drops the placeholder directors', () => {
      const extraction = extractMovieData(buildFullFlightPayload());
      const mapped = mapExtractedMovie(extraction.data!);

      expect(mapped.director).toBeUndefined();
    });

    it('keeps the real directors', () => {
      const payload = buildFullFlightPayload({
        ...buildFullFlightPayloadMovieData(),
        directors: 'Nguyễn Đình D',
      });
      const extraction = extractMovieData(payload);
      const mapped = mapExtractedMovie(extraction.data!);

      expect(mapped.director).toEqual(['Nguyễn Đình D']);
    });

    it('maps every server group of the real fixture', () => {
      const extraction = extractMovieData(buildFullFlightPayload());
      const mapped = mapExtractedMovie(extraction.data!);

      // The production documents only carry the episodes of the server the
      // movie was crawled from (`nguonc`).
      expect(mapped.episodes?.map((server) => server.server_name)).toEqual([
        'Vietsub #1',
        'Thuyết minh #1',
      ]);
    });

    it('stores the format group as the quality of the movie', () => {
      const extraction = extractMovieData(buildFullFlightPayload());
      const mapped = mapExtractedMovie(extraction.data!);

      // The `Format` master data stores the format group (`Phim bộ`), not the
      // video quality reported by the source (`FHD`).
      expect(mapped.quality).toBe('Phim bộ');
    });
  });
});

/**
 * Returns the movie data of the standard fixture.
 *
 * @returns The movie data.
 */
function buildFullFlightPayloadMovieData(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      id: 'x',
      name: 'Y',
      slug: 'y',
      sources: [],
    }),
  );
}
