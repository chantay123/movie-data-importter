import { describe, expect, it } from 'vitest';
import { ImportStatus, SkipReason } from '../src/constants/importStatus';
import { buildComparison, diffMovie, resolveAmbiguousTarget } from '../src/services/movieDiff.service';
import { mapMovie } from '../src/services/movieMapper.service';
import { VALID_MOVIE_JSON } from './fixtures/movieFixtures';

describe('movieDiff.service - detection of the unchanged movies', () => {
  it('reports no change when the database holds the same values', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        originName: 'Doctor X',
        content: 'Nội dung tóm tắt của bộ phim Bác Sĩ X.',
        sourceId: 'ophim-abc123',
        releaseDate: new Date(Date.UTC(2023, 0, 1)).toISOString(),
        status: 'completed',
        time: '45 phút/tập',
        episodeCurrent: '10',
        episodeTotal: '12',
        lang: 'Vietsub',
        thumbUrl: 'https://img.example.com/bac-si-x-thumb.jpg',
        posterUrl: 'https://img.example.com/bac-si-x-poster.jpg',
        actor: ['Nguyễn Văn A', 'Trần Thị B'],
        director: ['Đạo diễn C'],
        tmdb: { id: '12345', type: 'tv', season: 1 },
        episodes: [
          {
            server_name: 'Vietsub #1',
            server_data: [
              {
                name: '1',
                slug: 'tap-1',
                filename: 'tap-1',
                link_embed: 'https://example.com/embed/episode-1',
                link_m3u8: '',
              },
              {
                name: '2',
                slug: 'tap-2',
                filename: 'tap-2',
                link_embed: 'https://example.com/embed/episode-2',
                link_m3u8: 'https://example.com/stream/episode-2.m3u8',
              },
            ],
          },
          {
            server_name: 'Vietsub #2',
            server_data: [
              {
                name: '1',
                slug: 'tap-1',
                filename: 'tap-1',
                link_embed: 'https://example.com/embed/episode-1-server2',
                link_m3u8: '',
              },
            ],
          },
        ],
      },
      candidates: [],
    });

    expect(comparison.hasChanges).toBe(false);
    expect(comparison.changedFields).toEqual([]);
    expect(comparison.updatableFields).toEqual([]);
  });

  it('reports the fields that differ when the database is out of date', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: { _id: '1', name: 'Bác Sĩ X', slug: 'bac-si-x', content: 'Nội dung cũ' },
      candidates: [],
    });

    expect(comparison.hasChanges).toBe(true);
    expect(comparison.changedFields).toContain('content');
  });

  it('always reports a change for a movie that does not exist yet', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'NEW',
      candidates: [],
    });

    expect(comparison.hasChanges).toBe(true);
  });

  it('ignores the derived search keys when deciding whether the movie changed', () => {
    const mapped = mapMovie({ name: 'Phim', slug: 'phim' });
    const diffs = diffMovie(mapped, { _id: '1', name: 'Phim' });

    // The search keys are not part of the raw JSON payload, therefore they
    // are simply missing and never reported as a change.
    const normalized = diffs.find((diff) => diff.field === 'name_normalized');
    expect(normalized?.status).not.toBe('CHANGED');
  });

  it('detects a new episode as a change', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        episodes: [
          {
            server_name: 'Vietsub #1',
            server_data: [
              {
                name: '1',
                slug: 'tap-1',
                filename: 'tap-1',
                link_embed: 'https://example.com/embed/episode-1',
                link_m3u8: '',
              },
            ],
          },
        ],
      },
      candidates: [],
    });

    expect(comparison.hasChanges).toBe(true);
    expect(comparison.changedFields).toContain('episodes');
  });

  it('detects an updated episode link as a change', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        episodes: [
          {
            server_name: 'Vietsub #1',
            server_data: [
              {
                name: '1',
                slug: 'tap-1',
                filename: 'tap-1',
                link_embed: 'https://old-link/episode-1',
                link_m3u8: '',
              },
              {
                name: '2',
                slug: 'tap-2',
                filename: 'tap-2',
                link_embed: 'https://example.com/embed/episode-2',
                link_m3u8: 'https://example.com/stream/episode-2.m3u8',
              },
            ],
          },
          {
            server_name: 'Vietsub #2',
            server_data: [
              {
                name: '1',
                slug: 'tap-1',
                filename: 'tap-1',
                link_embed: 'https://example.com/embed/episode-1-server2',
                link_m3u8: '',
              },
            ],
          },
        ],
      },
      candidates: [],
    });

    expect(comparison.hasChanges).toBe(true);
    expect(comparison.changedFields).toContain('episodes');
  });

  it('compares the release date by year', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        // The crawler stores the first day of the year in the local timezone.
        releaseDate: '2022-12-31T17:00:00.000Z',
      },
      candidates: [],
    });

    expect(comparison.changedFields).not.toContain('releaseDate');
  });

  it('does not report a change when the image was migrated to Cloudinary', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        thumbUrl: 'https://res.cloudinary.com/demo/image/upload/movie/bac-si-x.jpg',
        originalThumbUrl: 'https://img.example.com/bac-si-x-thumb.jpg',
        posterUrl: 'https://res.cloudinary.com/demo/image/upload/movie/bac-si-x.png',
        originalPosterUrl: 'https://img.example.com/bac-si-x-poster.jpg',
      },
      candidates: [],
    });

    expect(comparison.changedFields).not.toContain('thumbUrl');
    expect(comparison.changedFields).not.toContain('posterUrl');
  });

  it('does not report a change when the summary only differs by its markup', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        content: '<p>Nội dung tóm tắt của bộ phim Bác Sĩ X.</p>',
      },
      candidates: [],
    });

    expect(comparison.changedFields).not.toContain('content');
  });

  it('does not report a change for the relations when they could not be read', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        originName: 'Doctor X',
        content: 'Nội dung tóm tắt của bộ phim Bác Sĩ X.',
        sourceId: 'ophim-abc123',
        releaseDate: new Date(Date.UTC(2023, 0, 1)).toISOString(),
        status: 'completed',
        time: '45 phút/tập',
        episodeCurrent: '10',
        episodeTotal: '12',
        lang: 'Vietsub',
        thumbUrl: 'https://img.example.com/bac-si-x-thumb.jpg',
        posterUrl: 'https://img.example.com/bac-si-x-poster.jpg',
        actor: ['Nguyễn Văn A', 'Trần Thị B'],
        director: ['Đạo diễn C'],
        tmdb: { id: '12345', type: 'tv', season: 1 },
        episodes: [
          {
            server_name: 'Vietsub #1',
            server_data: [
              {
                name: '1',
                slug: 'tap-1',
                filename: 'tap-1',
                link_embed: 'https://example.com/embed/episode-1',
                link_m3u8: '',
              },
              {
                name: '2',
                slug: 'tap-2',
                filename: 'tap-2',
                link_embed: 'https://example.com/embed/episode-2',
                link_m3u8: 'https://example.com/stream/episode-2.m3u8',
              },
            ],
          },
          {
            server_name: 'Vietsub #2',
            server_data: [
              {
                name: '1',
                slug: 'tap-1',
                filename: 'tap-1',
                link_embed: 'https://example.com/embed/episode-1-server2',
                link_m3u8: '',
              },
            ],
          },
        ],
        // The junction collections could not be read.
        relationsLoaded: false,
      },
      candidates: [],
    });

    // The relations were never compared: they must not be reported as changed,
    // otherwise the movie could never be recognized as already up-to-date.
    expect(comparison.changedFields).not.toContain('categories');
    expect(comparison.changedFields).not.toContain('countries');
    expect(comparison.updatableFields).not.toContain('categories');
    expect(comparison.updatableFields).not.toContain('countries');
    expect(comparison.hasChanges).toBe(false);
  });

  it('reports a change for the relations when they could be read', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);

    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: {
        _id: '1',
        name: 'Bác Sĩ X',
        slug: 'bac-si-x',
        relationsLoaded: true,
        categories: [{ name: 'Hài', slug: 'hai' }],
        countries: [{ name: 'Hàn Quốc', slug: 'han-quoc' }],
      },
      candidates: [],
    });

    expect(comparison.changedFields).toContain('categories');
    expect(comparison.changedFields).not.toContain('countries');
  });
});

describe('movieDiff.service - resolution of an ambiguous match', () => {
  const candidates = [
    { _id: 'a', name: 'Bác Sĩ X', slug: 'bac-si-x', content: 'Nội dung cũ' },
    { _id: 'b', name: 'Bác Sĩ X', slug: 'bac-si-x-2', content: 'Nội dung cũ' },
  ];

  it('writes nothing while the target has not been chosen', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const comparison = buildComparison('file-1', mapped, {
      status: 'AMBIGUOUS',
      candidates,
    });

    expect(comparison.updatableFields).toEqual([]);
    expect(comparison.existing).toBeUndefined();
  });

  it('rebuilds the comparison against the chosen candidate', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const comparison = buildComparison('file-1', mapped, {
      status: 'AMBIGUOUS',
      candidates,
    });

    const resolved = resolveAmbiguousTarget('file-1', mapped, comparison, 'b');

    expect(resolved.existing?._id).toBe('b');
    expect(resolved.updatableFields).toContain('content');
    expect(resolved.changedFields).toContain('content');
  });

  it('keeps the original comparison when the target is unknown', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const comparison = buildComparison('file-1', mapped, {
      status: 'AMBIGUOUS',
      candidates,
    });

    const resolved = resolveAmbiguousTarget('file-1', mapped, comparison, 'does-not-exist');

    expect(resolved).toBe(comparison);
    expect(resolved.updatableFields).toEqual([]);
  });

  it('skips the resolution for a match that is not ambiguous', () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const comparison = buildComparison('file-1', mapped, {
      status: 'MATCHED',
      movie: candidates[0],
      candidates: [candidates[0]],
    });

    const resolved = resolveAmbiguousTarget('file-1', mapped, comparison, 'b');

    expect(resolved).toBe(comparison);
    expect(resolved.existing?._id).toBe('a');
  });
});

describe('importStatus constants', () => {
  it('exposes the reasons why a file can be skipped', () => {
    expect(SkipReason.ALREADY_EXISTS).toBe('ALREADY_EXISTS');
    expect(SkipReason.DUPLICATE_IN_BATCH).toBe('DUPLICATE_IN_BATCH');
    expect(ImportStatus.SKIPPED).toBe('SKIPPED');
  });
});
