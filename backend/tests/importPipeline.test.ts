import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportStatus as Status, ProcessingStage, SkipReason } from '../src/constants/importStatus';
import { buildTxtContent, VALID_MOVIE_JSON } from './fixtures/movieFixtures';

/**
 * In-memory replacement of the MongoDB layer.
 *
 * The mock implements the tiny subset of the mongoose API used by the
 * importer so the whole pipeline (parse -> map -> compare -> diff -> write)
 * can be exercised without a live database.
 */
interface StoredMovie {
  _id: string;
  [key: string]: unknown;
}

/**
 * Documents stored by the fake `Movie` model.
 */
const collection: StoredMovie[] = [];

/**
 * Sequence used to build the fake identifiers.
 */
let idSequence = 0;

/**
 * Matches a value against a MongoDB-like filter.
 *
 * @param document - The document to test.
 * @param filter - The MongoDB filter.
 * @returns `true` when the document matches the filter.
 */
function matchesFilter(document: StoredMovie, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];

    if (key === '_id') {
      return String(actual) === String(expected);
    }

    if (expected instanceof RegExp) {
      return typeof actual === 'string' && expected.test(actual);
    }

    if (typeof expected === 'object' && expected !== null && '$regex' in expected) {
      const options = (expected as { $options?: string }).$options;
      const flags = options && options.includes('i') ? 'i' : '';
      const pattern = new RegExp(String((expected as { $regex: unknown }).$regex), flags);
      return typeof actual === 'string' && pattern.test(actual);
    }

    if (typeof actual === 'string' && typeof expected === 'string') {
      return actual.toLowerCase() === expected.toLowerCase();
    }

    return String(actual) === String(expected);
  });
}

/**
 * Fake mongoose model implementing the calls used by the importer.
 */
const fakeMovieModel = {
  find(filter: Record<string, unknown>): {
    limit(count: number): { lean(): Promise<StoredMovie[]> };
  } {
    return {
      limit(count: number): { lean(): Promise<StoredMovie[]> } {
        return {
          async lean(): Promise<StoredMovie[]> {
            return collection.filter((doc) => matchesFilter(doc, filter)).slice(0, count);
          },
        };
      },
    };
  },
  findOne(filter: Record<string, unknown>): { lean(): Promise<StoredMovie | null> } {
    return {
      async lean(): Promise<StoredMovie | null> {
        return collection.find((doc) => matchesFilter(doc, filter)) ?? null;
      },
    };
  },
  findById(id: string): { lean(): Promise<StoredMovie | null> } {
    return {
      async lean(): Promise<StoredMovie | null> {
        return collection.find((doc) => String(doc._id) === String(id)) ?? null;
      },
    };
  },
  async create(document: Record<string, unknown>): Promise<{ _id: string }> {
    const created: StoredMovie = { ...document, _id: `movie_${++idSequence}` };
    collection.push(created);
    return { _id: created._id };
  },
  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<StoredMovie | null> {
    const target = collection.find((doc) => matchesFilter(doc, filter));
    if (!target) {
      return null;
    }

    const set = (update['$set'] ?? {}) as Record<string, unknown>;
    Object.assign(target, set, { updatedAt: new Date().toISOString() });
    return target;
  },
};

vi.mock('../src/database/crawlerModels', () => ({
  getMovieModel: (): typeof fakeMovieModel => fakeMovieModel,
  getModels: (): Record<string, unknown> => ({
    Movie: fakeMovieModel,
    Category: { findOrCreate: async (): Promise<null> => null },
    Country: { findOrCreate: async (): Promise<null> => null },
    Actor: { findOrCreate: async (): Promise<null> => null },
    Director: { findOrCreate: async (): Promise<null> => null },
    MovieCategory: { setCategories: async (): Promise<void> => undefined },
    MovieCountry: { setCountries: async (): Promise<void> => undefined },
    MovieActor: { setActors: async (): Promise<void> => undefined },
    MovieDirector: { setDirectors: async (): Promise<void> => undefined },
  }),
  getMongoose: (): Record<string, unknown> => ({
    connection: { readyState: 1, name: 'test' },
    connect: async (): Promise<void> => undefined,
    disconnect: async (): Promise<void> => undefined,
    set: (): void => undefined,
    models: {},
  }),
  getCrawlerProjectPath: (): string => 'C:/mock/crawl-data-movie',
}));

vi.mock('../src/database/mongo-client', () => ({
  isDatabaseReady: (): boolean => true,
  getDatabaseStatus: (): Record<string, unknown> => ({
    connected: true,
    database: 'test',
    readyState: 1,
    crawlerProject: 'C:/mock/crawl-data-movie',
  }),
  connectDatabase: async (): Promise<void> => undefined,
  disconnectDatabase: async (): Promise<void> => undefined,
}));

const { createJob, getJob, processFile, setComparison } = await import(
  '../src/services/importJob.service'
);
const { importMovie } = await import('../src/services/movieImport.service');
const { mapMovie } = await import('../src/services/movieMapper.service');
const { findMatchingMovie } = await import('../src/services/movieMatcher.service');
const { buildComparison } = await import('../src/services/movieDiff.service');

describe('import pipeline (end to end, without a live database)', () => {
  beforeEach(() => {
    collection.length = 0;
    idSequence = 0;
  });

  it('parses a TXT file, maps it and reports the file as processed', async () => {
    const job = createJob([
      { path: 'movie-1.txt', name: 'movie-1.txt', size: 512, content: buildTxtContent(VALID_MOVIE_JSON) },
    ]);
    const file = job.files[0];

    await processFile(job.id, file.id, buildTxtContent(VALID_MOVIE_JSON));

    const processed = getJob(job.id)?.files[0];
    // The file is only parsed and compared: it is not written until the user
    // confirms the import.
    expect(processed?.status).toBe(Status.PARSED);
    expect(processed?.imported).toBeFalsy();
    expect(processed?.stage).toBe(ProcessingStage.COMPLETED);
    expect(processed?.detectedName).toBe('Bác Sĩ X');
    expect(processed?.episodeCount).toBe(3);
    expect(processed?.readableFieldCount).toBeGreaterThan(0);
    expect(processed?.progress).toBe(100);
  });

  it('reports a broken file as failed without stopping the batch', async () => {
    const job = createJob([
      { path: 'broken.txt', name: 'broken.txt', size: 20, content: 'this is not json' },
      { path: 'movie-1.txt', name: 'movie-1.txt', size: 512, content: buildTxtContent(VALID_MOVIE_JSON) },
    ]);

    const [broken, valid] = job.files;

    await processFile(job.id, broken.id, 'this is not json');
    await processFile(job.id, valid.id, buildTxtContent(VALID_MOVIE_JSON));

    const files = getJob(job.id)?.files ?? [];
    expect(files[0]?.status).toBe(Status.FAILED);
    expect(files[0]?.error).toContain('movieData');
    expect(files[1]?.status).toBe(Status.PARSED);
    expect(getJob(job.id)?.counters.processed).toBe(2);
  });

  it('keeps two files of different sub-folders apart', () => {
    const job = createJob([
      { path: 'a/movie.txt', name: 'movie.txt', size: 10, content: 'a' },
      { path: 'b/movie.txt', name: 'movie.txt', size: 10, content: 'b' },
    ]);

    expect(job.files).toHaveLength(2);
    expect(job.files[0]?.fileName).toBe('movie.txt');
    expect(job.files[1]?.fileName).toBe('movie.txt');
    expect(job.files[0]?.filePath).toBe('a/movie.txt');
    expect(job.files[1]?.filePath).toBe('b/movie.txt');
  });

  it('classifies a movie as NEW when the database does not contain it', async () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const match = await findMatchingMovie(mapped);

    expect(match.status).toBe('NEW');
    expect(match.candidates).toHaveLength(0);
  });

  it('creates a document and never writes a missing field', async () => {
    const mapped = mapMovie({ name: 'Phim Mới', slug: 'phim-moi', info: { year: 2024 } });
    const outcome = await importMovie('file-1', 'phim-moi.txt', mapped, { name: 'Phim Mới' }, undefined, {
      selectedFields: ['name', 'slug', 'content'],
      dryRun: false,
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.operation).toBe('CREATE');

    const created = collection[0];
    expect(created?.['name']).toBe('Phim Mới');
    expect(created?.['content']).toBeUndefined();
    expect(created?.['releaseDate']).toBeUndefined();
  });

  it('updates an existing document with $set and keeps the untouched fields', async () => {
    collection.push({
      _id: 'movie_existing',
      name: 'Bác Sĩ X',
      slug: 'bac-si-x',
      content: 'Nội dung cũ',
      actor: ['Diễn viên cũ'],
      viewCount: 999,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const mapped = mapMovie(VALID_MOVIE_JSON);
    const match = await findMatchingMovie(mapped);
    expect(match.status).toBe('MATCHED');

    const comparison = buildComparison('file-1', mapped, {
      status: match.status,
      matchedBy: match.matchedBy,
      movie: match.movie,
      candidates: match.candidates,
    });

    expect(comparison.updatableFields).toContain('content');
    expect(comparison.updatableFields).not.toContain('viewCount');

    const outcome = await importMovie(
      'file-1',
      'bac-si-x.txt',
      mapped,
      VALID_MOVIE_JSON,
      match.movie,
      { selectedFields: comparison.updatableFields, dryRun: false },
    );

    expect(outcome.error).toBeUndefined();
    expect(outcome.operation).toBe('UPDATE');

    const updated = collection[0];
    expect(updated?.['content']).toBe(VALID_MOVIE_JSON.content);
    expect(updated?.['viewCount']).toBe(999);
    expect(updated?.['actor']).toEqual(['Diễn viên cũ', 'Nguyễn Văn A', 'Trần Thị B']);
  });

  it('does not create a duplicate when the same slug already exists', async () => {
    collection.push({ _id: 'movie_1', name: 'Phim Mới', slug: 'phim-moi' });

    const mapped = mapMovie({ name: 'Phim Mới', slug: 'phim-moi' });
    const outcome = await importMovie('file-1', 'phim-moi.txt', mapped, { name: 'Phim Mới' }, undefined, {
      selectedFields: ['name', 'slug'],
      dryRun: false,
    });

    expect(outcome.error).toContain('already exists');
    expect(collection).toHaveLength(1);
  });

  it('produces no write at all during a dry run', async () => {
    const mapped = mapMovie(VALID_MOVIE_JSON);
    const outcome = await importMovie('file-1', 'bac-si-x.txt', mapped, VALID_MOVIE_JSON, undefined, {
      selectedFields: ['name', 'content'],
      dryRun: true,
    });

    expect(outcome.operation).toBe('CREATE');
    expect(collection).toHaveLength(0);
  });

  it('stores the comparison of a processed file so the panel can display it', async () => {
    const job = createJob([
      { path: 'movie-1.txt', name: 'movie-1.txt', size: 512, content: buildTxtContent(VALID_MOVIE_JSON) },
    ]);
    const file = job.files[0];

    await processFile(job.id, file.id, buildTxtContent(VALID_MOVIE_JSON));

    const mapped = mapMovie(VALID_MOVIE_JSON);
    const match = await findMatchingMovie(mapped);
    const comparison = buildComparison(file.id, mapped, {
      status: match.status,
      matchedBy: match.matchedBy,
      movie: match.movie,
      candidates: match.candidates,
    });

    setComparison(job.id, comparison);

    expect(getJob(job.id)?.counters.total).toBe(1);
    expect(getJob(job.id)?.counters.parsed).toBe(1);
    expect(getJob(job.id)?.counters.imported).toBe(0);
  });

  it('marks a file as "already there" and skips it when the movie brings no change', async () => {
    collection.push({
      _id: 'movie_existing',
      name: 'Bác Sĩ X',
      slug: 'bac-si-x',
      originName: 'Doctor X',
      content: 'Nội dung tóm tắt của bộ phim Bác Sĩ X.',
      sourceId: 'ophim-abc123',
      releaseDate: new Date(Date.UTC(2023, 0, 1)),
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
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const job = createJob([
      { path: 'movie-1.txt', name: 'movie-1.txt', size: 512, content: buildTxtContent(VALID_MOVIE_JSON) },
    ]);
    const file = job.files[0];

    await processFile(job.id, file.id, buildTxtContent(VALID_MOVIE_JSON));

    const processed = getJob(job.id)?.files[0];

    expect(processed?.status).toBe(Status.SKIPPED);
    expect(processed?.skipReason).toBe(SkipReason.ALREADY_EXISTS);
    expect(processed?.alreadyExists).toBe(true);
    expect(processed?.imported).toBe(false);
    expect(processed?.changedFields).toEqual([]);

    const counters = getJob(job.id)?.counters;
    expect(counters?.skipped).toBe(1);
    expect(counters?.unchanged).toBe(1);
    expect(counters?.parsed).toBe(0);

    // Nothing was written: the document is still the one of the database.
    expect(collection).toHaveLength(1);
    expect(collection[0]?.['updatedAt']).toBe('2024-01-01T00:00:00.000Z');
  });

  it('keeps a file importable when the movie of the database differs', async () => {
    collection.push({
      _id: 'movie_existing',
      name: 'Bác Sĩ X',
      slug: 'bac-si-x',
      content: 'Nội dung cũ',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const job = createJob([
      { path: 'movie-1.txt', name: 'movie-1.txt', size: 512, content: buildTxtContent(VALID_MOVIE_JSON) },
    ]);
    const file = job.files[0];

    await processFile(job.id, file.id, buildTxtContent(VALID_MOVIE_JSON));

    const processed = getJob(job.id)?.files[0];

    expect(processed?.status).toBe(Status.PARSED);
    expect(processed?.alreadyExists).toBe(true);
    expect(processed?.skipReason).toBeUndefined();
    expect(processed?.changedFields).toContain('content');
  });

  it('skips the second file of a batch that targets the same movie', async () => {
    const job = createJob([
      { path: 'movie-1.txt', name: 'movie-1.txt', size: 512, content: buildTxtContent(VALID_MOVIE_JSON) },
      { path: 'movie-2.txt', name: 'movie-2.txt', size: 512, content: buildTxtContent(VALID_MOVIE_JSON) },
    ]);
    const [first, second] = job.files;

    await processFile(job.id, first.id, buildTxtContent(VALID_MOVIE_JSON));
    await processFile(job.id, second.id, buildTxtContent(VALID_MOVIE_JSON));

    const files = getJob(job.id)?.files ?? [];

    expect(files[0]?.status).toBe(Status.PARSED);
    expect(files[1]?.status).toBe(Status.SKIPPED);
    expect(files[1]?.skipReason).toBe(SkipReason.DUPLICATE_IN_BATCH);
  });
});
