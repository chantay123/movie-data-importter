"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeManagedObject = mergeManagedObject;
exports.buildUpdateDocument = buildUpdateDocument;
exports.importMovie = importMovie;
exports.buildLogEntry = buildLogEntry;
exports.getMergeStrategy = getMergeStrategy;
exports.isEpisodeServerList = isEpisodeServerList;
const importStatus_1 = require("../constants/importStatus");
const crawlerModels_1 = require("../database/crawlerModels");
const mongo_client_1 = require("../database/mongo-client");
const normalizeSlug_1 = require("../utils/normalizeSlug");
const movieDiff_service_1 = require("./movieDiff.service");
const movieMapper_service_1 = require("./movieMapper.service");
/**
 * Nested fields of the `Movie` schema that are merged instead of replaced.
 */
const NESTED_MERGE_FIELDS = new Set(['trailer', 'tmdb']);
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
function mergeManagedObject(existing, incoming) {
    const merged = existing && typeof existing === 'object'
        ? { ...existing }
        : {};
    if (!incoming || typeof incoming !== 'object') {
        return merged;
    }
    for (const [key, value] of Object.entries(incoming)) {
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
function buildUpdateDocument(mapped, raw, existing, selectedFields) {
    const full = (0, movieMapper_service_1.toMovieDocument)(mapped, raw);
    const document = {};
    const writtenFields = [];
    for (const field of selectedFields) {
        if (movieDiff_service_1.PROTECTED_FIELDS.has(field)) {
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
            const merged = (0, movieDiff_service_1.mergeEpisodes)(existing?.episodes, mapped.episodes);
            if (merged.added === 0 && merged.updated === 0) {
                continue;
            }
            document['episodes'] = merged.episodes;
            writtenFields.push('episodes');
            continue;
        }
        if (field === 'actor' || field === 'director') {
            const merged = (0, movieDiff_service_1.mergeStringArray)(field === 'actor' ? existing?.actor : existing?.director, mapped[field]);
            document[field] = merged;
            writtenFields.push(field);
            continue;
        }
        if (field === 'trailer' || field === 'tmdb') {
            // The nested objects of the `Movie` schema also carry fields managed by
            // the crawler (view count, vote average, ...). Only the keys carried by
            // the incoming payload are written, so the other ones are preserved.
            const current = existing?.[field];
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
async function importMovie(_fileId, _fileName, mapped, raw, existing, options) {
    const Movie = (0, crawlerModels_1.getMovieModel)();
    const { document, writtenFields } = buildUpdateDocument(mapped, raw, existing, options.selectedFields);
    const isCreate = !existing;
    if (options.dryRun) {
        return {
            operation: isCreate ? importStatus_1.ImportOperation.CREATE : importStatus_1.ImportOperation.UPDATE,
            movieId: existing?._id,
            updatedFields: writtenFields,
        };
    }
    if (!(0, mongo_client_1.isDatabaseReady)()) {
        return {
            operation: importStatus_1.ImportOperation.NONE,
            movieId: existing?._id,
            updatedFields: [],
            error: 'MongoDB is not connected. Check the connection settings of the crawler project and restart the importer API.',
        };
    }
    try {
        if (isCreate) {
            const slug = document['slug'] ?? (0, normalizeSlug_1.slugify)(mapped.name ?? '');
            if (!slug) {
                throw new Error('A slug is required to create the document');
            }
            const name = document['name'] ?? mapped.name;
            if (!name || name.trim().length === 0) {
                throw new Error('A name is required to create the document');
            }
            const duplicate = await Movie.findOne({ slug }).lean();
            if (duplicate) {
                throw new Error(`A document with the slug "${slug}" already exists, the import was skipped to avoid a duplicate`);
            }
            const created = await Movie.create({ ...document, slug, name });
            await syncRelations(String(created._id), mapped);
            return {
                operation: importStatus_1.ImportOperation.CREATE,
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
        const current = (await Movie.findById(targetId).lean());
        if (!current) {
            throw new Error(`The document ${targetId} no longer exists`);
        }
        const updatedAtBefore = current['updatedAt']
            ? new Date(current['updatedAt']).getTime()
            : 0;
        const updatedAtAfter = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        if (updatedAtAfter > 0 && updatedAtBefore !== updatedAtAfter) {
            throw new Error('The document was modified by someone else after the comparison, please review it again');
        }
        if (Object.keys(document).length === 0) {
            return {
                operation: importStatus_1.ImportOperation.NONE,
                movieId: targetId,
                updatedFields: [],
            };
        }
        // The nested objects are merged with the values currently stored in
        // MongoDB: the fields managed by the crawler (view count, vote average,
        // ...) must not be erased by an import.
        const writeDocument = { ...document };
        for (const field of NESTED_MERGE_FIELDS) {
            if (!(field in writeDocument)) {
                continue;
            }
            writeDocument[field] = mergeManagedObject(current[field], writeDocument[field]);
        }
        const updated = await Movie.findOneAndUpdate({ _id: targetId }, { $set: writeDocument }, { new: true });
        if (!updated) {
            throw new Error(`The document ${targetId} could not be updated`);
        }
        await syncRelations(targetId, mapped);
        return {
            operation: importStatus_1.ImportOperation.UPDATE,
            movieId: targetId,
            updatedFields: writtenFields,
        };
    }
    catch (error) {
        return {
            operation: importStatus_1.ImportOperation.NONE,
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
async function syncRelations(movieId, mapped) {
    const models = (0, crawlerModels_1.getModels)();
    if (mapped.categories && mapped.categories.length > 0) {
        const categoryIds = [];
        for (const category of mapped.categories) {
            const created = await models.Category.findOrCreate({
                name: category.name,
                slug: category.slug || (0, normalizeSlug_1.slugify)(category.name),
            });
            if (created?._id) {
                categoryIds.push(created._id);
            }
        }
        await models.MovieCategory.setCategories(movieId, categoryIds);
    }
    if (mapped.countries && mapped.countries.length > 0) {
        const countryIds = [];
        for (const country of mapped.countries) {
            const created = await models.Country.findOrCreate({
                name: country.name,
                slug: country.slug || (0, normalizeSlug_1.slugify)(country.name),
            });
            if (created?._id) {
                countryIds.push(created._id);
            }
        }
        await models.MovieCountry.setCountries(movieId, countryIds);
    }
    if (mapped.actor && mapped.actor.length > 0) {
        const actorRecords = [];
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
        const directorRecords = [];
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
function buildLogEntry(fileId, fileName, mapped, outcome) {
    return {
        fileId,
        fileName,
        movieName: mapped.name ?? '(unknown)',
        slug: mapped.slug ?? '',
        movieId: outcome.movieId,
        operation: outcome.operation,
        updatedFields: outcome.updatedFields,
        status: outcome.error ? importStatus_1.ImportStatus.FAILED : importStatus_1.ImportStatus.SUCCESS,
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
function getMergeStrategy(diff) {
    return diff.mergeStrategy ?? importStatus_1.MergeStrategy.REPLACE;
}
/**
 * Type guard used to check that a value is a list of episode servers.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a list of episode servers.
 */
function isEpisodeServerList(value) {
    return (Array.isArray(value) &&
        value.every((server) => typeof server === 'object' &&
            server !== null &&
            typeof server.server_name === 'string' &&
            Array.isArray(server.server_data)));
}
//# sourceMappingURL=movieImport.service.js.map