import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportStatus as Status, ProcessingStage } from '../src/constants/importStatus';
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
    const job = createJob(['movie-1.txt'], new Map([['movie-1.txt', 512]]));
    const file = job.files[0];

    await processFile(job.id, file.id, buildTxtContent(VALID_MOVIE_JSON));

    const processed = getJob(job.id)?.files[0];
    expect(processed?.status).toBe(Status.SUCCESS);
    expect(processed?.stage).toBe(ProcessingStage.COMPLETED);
    expect(processed?.detectedName).toBe('Bác Sĩ X');
    expect(processed?.episodeCount).toBe(3);
    expect(processed?.readableFieldCount).toBeGreaterThan(0);
    expect(processed?.progress).toBe(100);
  });

  it('reports a broken file as failed without stopping the batch', async () => {
    const job = createJob(
      ['broken.txt', 'movie-1.txt'],
      new Map([
        ['broken.txt', 20],
        ['movie-1.txt', 512],
      ]),
    );

    const [broken, valid] = job.files;

    await processFile(job.id, broken.id, 'this is not json');
    await processFile(job.id, valid.id, buildTxtContent(VALID_MOVIE_JSON));

    const files = getJob(job.id)?.files ?? [];
    expect(files[0]?.status).toBe(Status.FAILED);
    expect(files[0]?.error).toContain('movieData');
    expect(files[1]?.status).toBe(Status.SUCCESS);
    expect(getJob(job.id)?.counters.processed).toBe(2);
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
    const job = createJob(['movie-1.txt'], new Map([['movie-1.txt', 512]]));
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
    expect(getJob(job.id)?.counters.success).toBe(1);
  });
});
