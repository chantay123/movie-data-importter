import { ImportOperation, ImportStatus, MergeStrategy } from '../constants/importStatus';
import { getModels, getMovieModel } from '../database/crawlerModels';
import { isDatabaseReady } from '../database/mongo-client';
import type {
  EpisodeServer,
  ExistingMovie,
  FieldDiff,
  ImportLogEntry,
  MappedMovie,
  RawMovieJson,
} from '../types/movieImport.types';
import { slugify } from '../utils/normalizeSlug';
import { mergeEpisodes, mergeStringArray, PROTECTED_FIELDS } from './movieDiff.service';
import { toMovieDocument } from './movieMapper.service';

/**
 * Writer responsible for persisting the reviewed movies into MongoDB.
 *
 * The writer never replaces a whole document: it always uses `$set` with the
 * fields that were explicitly selected by the user, which guarantees that the
 * fields missing from the TXT file keep their current value.
 */

/**
 * Options accepted when a movie is written.
 */
export interface ImportOptions {
  /** Fields the user selected for the update. */
  selectedFields: string[];
  /** Whether the write must be performed (`false` for a dry run). */
  dryRun: boolean;
  /** Explicit document chosen by the user when the match was ambiguous. */
  targetMovieId?: string;
}

/**
 * Outcome of a single write.
 */
export interface ImportOutcome {
  /** Type of the write. */
  operation: ImportOperation;
  /** Identifier of the written document. */
  movieId?: string;
  /** Fields that were written. */
  updatedFields: string[];
  /** Error message when the write failed. */
  error?: string;
}

/**
 * Nested fields of the `Movie` schema that are merged instead of replaced.
 */
const NESTED_MERGE_FIELDS: ReadonlySet<string> = new Set(['trailer', 'tmdb']);

/**
 * Merges a nested object with the one already stored in MongoDB.
 *
 * Only the keys carried by the incoming payload are written: the other keys of
 * the stored object (managed by the crawler) keep their current value.
 *
 * @param existing - Object currently stored in MongoDB.
 * @param incoming - Object coming from the TXT file.
 * @returns The merged object.
 */
export function mergeManagedObject(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const merged: Record<string, unknown> =
    existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (!incoming || typeof incoming !== 'object') {
    return merged;
  }

  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

/**
 * Builds the `$set` document from the selected fields.
 *
 * @param mapped - The mapped movie coming from the TXT file.
 * @param raw - The raw payload, used to derive the release date.
 * @param existing - The document currently stored in MongoDB.
 * @param selectedFields - Fields the user selected.
 * @returns The `$set` document and the list of written fields.
 */
export function buildUpdateDocument(
  mapped: MappedMovie,
  raw: RawMovieJson | undefined,
  existing: ExistingMovie | undefined,
  selectedFields: string[],
): { document: Record<string, unknown>; writtenFields: string[] } {
  const full = toMovieDocument(mapped, raw) as Record<string, unknown>;
  const document: Record<string, unknown> = {};
  const writtenFields: string[] = [];

  for (const field of selectedFields) {
    if (PROTECTED_FIELDS.has(field)) {
      continue;
    }

    if (!(field in full)) {
      continue;
    }

    const value = full[field];
    if (value === undefined || value === null) {
      continue;
    }

    if (field === 'episodes') {
      const merged = mergeEpisodes(existing?.episodes, mapped.episodes);
      if (merged.added === 0 && merged.updated === 0) {
        continue;
      }
      document['episodes'] = merged.episodes;
      writtenFields.push('episodes');
      continue;
    }

    if (field === 'actor' || field === 'director') {
      const merged = mergeStringArray(
        field === 'actor' ? existing?.actor : existing?.director,
        mapped[field],
      );
      document[field] = merged;
      writtenFields.push(field);
      continue;
    }

    if (field === 'trailer' || field === 'tmdb') {
      // The nested objects of the `Movie` schema also carry fields managed by
      // the crawler (view count, vote average, ...). Only the keys carried by
      // the incoming payload are written, so the other ones are preserved.
      const current = (existing as unknown as Record<string, unknown> | undefined)?.[field];
      const merged = mergeManagedObject(current, value);
      document[field] = merged;
      writtenFields.push(field);
      continue;
    }

    document[field] = value;
    writtenFields.push(field);
  }

  return { document, writtenFields };
}

/**
 * Writes a single movie into MongoDB.
 *
 * @param fileId - Identifier of the file.
 * @param fileName - Name of the file.
 * @param mapped - The mapped movie.
 * @param raw - The raw payload, when the file was a plain JSON document.
 * @param existing - The document currently stored in MongoDB.
 * @param options - The write options.
 * @returns The outcome of the write.
 */
export async function importMovie(
  _fileId: string,
  _fileName: string,
  mapped: MappedMovie,
  raw: RawMovieJson | undefined,
  existing: ExistingMovie | undefined,
  options: ImportOptions,
): Promise<ImportOutcome> {
  const Movie = getMovieModel();
  const { document, writtenFields } = buildUpdateDocument(
    mapped,
    raw,
    existing,
    options.selectedFields,
  );

  const isCreate = !existing;

  if (options.dryRun) {
    return {
      operation: isCreate ? ImportOperation.CREATE : ImportOperation.UPDATE,
      movieId: existing?._id,
      updatedFields: writtenFields,
    };
  }

  if (!isDatabaseReady()) {
    return {
      operation: ImportOperation.NONE,
      movieId: existing?._id,
      updatedFields: [],
      error:
        'MongoDB is not connected. Check the connection settings of the crawler project and restart the importer API.',
    };
  }

  try {
    if (isCreate) {
      const slug = (document['slug'] as string | undefined) ?? slugify(mapped.name ?? '');
      if (!slug) {
        throw new Error('A slug is required to create the document');
      }

      const name = (document['name'] as string | undefined) ?? mapped.name;
      if (!name || name.trim().length === 0) {
        throw new Error('A name is required to create the document');
      }

      const duplicate = await Movie.findOne({ slug }).lean();
      if (duplicate) {
        throw new Error(
          `A document with the slug "${slug}" already exists, the import was skipped to avoid a duplicate`,
        );
      }

      const created = await Movie.create({ ...document, slug, name });

      await syncRelations(String(created._id), mapped);

      return {
        operation: ImportOperation.CREATE,
        movieId: String(created._id),
        updatedFields: writtenFields,
      };
    }

    const targetId = options.targetMovieId ?? existing?._id;

    if (!targetId) {
      throw new Error('The target document could not be resolved');
    }

    // Optimistic concurrency: the document must not have changed since the
    // comparison was made, otherwise the update is refused.
    const current = (await Movie.findById(targetId).lean()) as Record<string, unknown> | null;
    if (!current) {
      throw new Error(`The document ${targetId} no longer exists`);
    }

    const updatedAtBefore = current['updatedAt']
      ? new Date(current['updatedAt'] as string).getTime()
      : 0;
    const updatedAtAfter = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;

    if (updatedAtAfter > 0 && updatedAtBefore !== updatedAtAfter) {
      throw new Error(
        'The document was modified by someone else after the comparison, please review it again',
      );
    }

    if (Object.keys(document).length === 0) {
      return {
        operation: ImportOperation.NONE,
        movieId: targetId,
        updatedFields: [],
      };
    }

    // The nested objects are merged with the values currently stored in
    // MongoDB: the fields managed by the crawler (view count, vote average,
    // ...) must not be erased by an import.
    const writeDocument: Record<string, unknown> = { ...document };

    for (const field of NESTED_MERGE_FIELDS) {
      if (!(field in writeDocument)) {
        continue;
      }

      writeDocument[field] = mergeManagedObject(current[field], writeDocument[field]);
    }

    const updated = await Movie.findOneAndUpdate(
      { _id: targetId },
      { $set: writeDocument },
      { new: true },
    );

    if (!updated) {
      throw new Error(`The document ${targetId} could not be updated`);
    }

    await syncRelations(targetId, mapped);

    return {
      operation: ImportOperation.UPDATE,
      movieId: targetId,
      updatedFields: writtenFields,
    };
  } catch (error) {
    return {
      operation: ImportOperation.NONE,
      movieId: existing?._id,
      updatedFields: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Synchronizes the normalized relations (categories, countries, actors,
 * directors) of a movie.
 *
 * The master data collections are reused as they are defined by the crawler
 * project: no new collection is created.
 *
 * @param movieId - Identifier of the movie document.
 * @param mapped - The mapped movie.
 */
async function syncRelations(movieId: string, mapped: MappedMovie): Promise<void> {
  const models = getModels();

  if (mapped.categories && mapped.categories.length > 0) {
    const categoryIds: unknown[] = [];

    for (const category of mapped.categories) {
      const created = await models.Category.findOrCreate({
        name: category.name,
        slug: category.slug || slugify(category.name),
      });
      if (created?._id) {
        categoryIds.push(created._id);
      }
    }

    await models.MovieCategory.setCategories(movieId, categoryIds);
  }

  if (mapped.countries && mapped.countries.length > 0) {
    const countryIds: unknown[] = [];

    for (const country of mapped.countries) {
      const created = await models.Country.findOrCreate({
        name: country.name,
        slug: country.slug || slugify(country.name),
      });
      if (created?._id) {
        countryIds.push(created._id);
      }
    }

    await models.MovieCountry.setCountries(movieId, countryIds);
  }

  if (mapped.actor && mapped.actor.length > 0) {
    const actorRecords: Array<Record<string, unknown>> = [];

    for (const [index, name] of mapped.actor.entries()) {
      const actor = await models.Actor.findOrCreate(name);
      if (actor?._id) {
        actorRecords.push({
          actorId: actor._id,
          order: index,
          isMain: index < 5,
          source: 'import',
        });
      }
    }

    await models.MovieActor.setActors(movieId, actorRecords);
  }

  if (mapped.director && mapped.director.length > 0) {
    const directorRecords: Array<Record<string, unknown>> = [];

    for (const [index, name] of mapped.director.entries()) {
      const director = await models.Director.findOrCreate(name);
      if (director?._id) {
        directorRecords.push({
          directorId: director._id,
          order: index,
          isMain: true,
          source: 'import',
        });
      }
    }

    await models.MovieDirector.setDirectors(movieId, directorRecords);
  }

  // The quality of a movie is stored in the `Format` master data and linked
  // through the `movieformats` junction collection.
  if (mapped.quality) {
    const format = await models.Format.findOrCreate({
      name: mapped.quality,
      slug: slugify(mapped.quality),
    });

    if (format?._id) {
      await models.MovieFormat.setFormats(movieId, [format._id]);
    }
  }

  // The release year is stored in the `Year` master data and linked through
  // the `movieyears` junction collection.
  if (mapped.year) {
    const year = await models.Year.findOrCreate(mapped.year);

    if (year?._id) {
      await models.MovieYear.setYear(movieId, year._id);
    }
  }
}

/**
 * Builds the log entry of a write.
 *
 * @param fileId - Identifier of the file.
 * @param fileName - Name of the file.
 * @param mapped - The mapped movie.
 * @param outcome - The outcome of the write.
 * @returns The log entry.
 */
export function buildLogEntry(
  fileId: string,
  fileName: string,
  mapped: MappedMovie,
  outcome: ImportOutcome,
): ImportLogEntry {
  return {
    fileId,
    fileName,
    movieName: mapped.name ?? '(unknown)',
    slug: mapped.slug ?? '',
    movieId: outcome.movieId,
    operation: outcome.operation,
    updatedFields: outcome.updatedFields,
    status: outcome.error ? ImportStatus.FAILED : ImportStatus.SUCCESS,
    error: outcome.error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Determines the merge strategy applied to a field.
 *
 * @param diff - The comparison of the field.
 * @returns The merge strategy.
 */
export function getMergeStrategy(diff: FieldDiff): MergeStrategy {
  return diff.mergeStrategy ?? MergeStrategy.REPLACE;
}

/**
 * Type guard used to check that a value is a list of episode servers.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a list of episode servers.
 */
export function isEpisodeServerList(value: unknown): value is EpisodeServer[] {
  return (
    Array.isArray(value) &&
    value.every(
      (server) =>
        typeof server === 'object' &&
        server !== null &&
        typeof (server as EpisodeServer).server_name === 'string' &&
        Array.isArray((server as EpisodeServer).server_data),
    )
  );
}
