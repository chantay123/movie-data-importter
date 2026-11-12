"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeRegExp = escapeRegExp;
exports.findMatchingMovie = findMatchingMovie;
const importStatus_1 = require("../constants/importStatus");
const crawlerModels_1 = require("../database/crawlerModels");
const mongo_client_1 = require("../database/mongo-client");
const normalizeText_1 = require("../utils/normalizeText");
/**
 * Database lookup of a parsed movie.
 *
 * The lookup criteria are applied in a strict order:
 *   1. `sourceId`
 *   2. `tmdb.id` (+ `tmdb.type` and `tmdb.season` when available)
 *   3. `slug`
 *   4. `name`
 *   5. `originName`
 *
 * A criterion that returns more than one document produces an `AMBIGUOUS`
 * result: the importer never merges data on its own when several documents
 * could match.
 */
/**
 * Projection used to load only the fields needed by the comparison.
 *
 * Every field compared by the diff service must be projected, otherwise the
 * database value would look empty and the field would wrongly be reported as
 * changed.
 */
const MOVIE_PROJECTION = {
    _id: 1,
    name: 1,
    slug: 1,
    originName: 1,
    content: 1,
    releaseDate: 1,
    status: 1,
    time: 1,
    episodeCurrent: 1,
    episodeTotal: 1,
    lang: 1,
    thumbUrl: 1,
    posterUrl: 1,
    notify: 1,
    showtimes: 1,
    actor: 1,
    director: 1,
    episodes: 1,
    sourceId: 1,
    'tmdb.id': 1,
    'tmdb.type': 1,
    'tmdb.season': 1,
    trailer: 1,
    updatedAt: 1,
};
/**
 * Escapes the characters that have a special meaning inside a regular expression.
 *
 * @param value - Raw value.
 * @returns The escaped value.
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Converts a lean document into the reduced shape used by the importer.
 *
 * @param document - Lean document coming from MongoDB.
 * @returns The reduced movie.
 */
function toExistingMovie(document) {
    const tmdb = document['tmdb'];
    return {
        _id: String(document['_id']),
        name: document['name'],
        slug: document['slug'],
        originName: document['originName'],
        content: document['content'],
        releaseDate: document['releaseDate']
            ? new Date(document['releaseDate']).toISOString()
            : null,
        status: document['status'],
        time: document['time'],
        episodeCurrent: document['episodeCurrent'],
        episodeTotal: document['episodeTotal'],
        lang: document['lang'],
        thumbUrl: document['thumbUrl'],
        posterUrl: document['posterUrl'],
        notify: document['notify'],
        showtimes: document['showtimes'],
        actor: Array.isArray(document['actor']) ? document['actor'] : [],
        director: Array.isArray(document['director']) ? document['director'] : [],
        episodes: Array.isArray(document['episodes'])
            ? document['episodes']
            : [],
        sourceId: document['sourceId'],
        tmdb: tmdb
            ? {
                id: tmdb['id'],
                type: tmdb['type'],
                season: tmdb['season'] ?? null,
            }
            : undefined,
        trailer: document['trailer'],
        updatedAt: document['updatedAt']
            ? new Date(document['updatedAt']).toISOString()
            : undefined,
    };
}
/**
 * Runs a MongoDB query and converts the documents.
 *
 * @param query - The MongoDB filter.
 * @returns The matching documents.
 */
async function runQuery(query) {
    if (!(0, mongo_client_1.isDatabaseReady)()) {
        throw new Error('MongoDB is not connected. Check the connection settings of the crawler project and restart the importer API.');
    }
    const Movie = (0, crawlerModels_1.getMovieModel)();
    const documents = (await Movie.find(query, MOVIE_PROJECTION).limit(20).lean());
    return documents.map(toExistingMovie);
}
/**
 * Looks a movie up inside MongoDB.
 *
 * @param mapped - The mapped movie coming from the TXT file.
 * @returns The result of the lookup.
 */
async function findMatchingMovie(mapped) {
    // 1. sourceId
    if (mapped.sourceId) {
        const bySource = await runQuery({ sourceId: mapped.sourceId });
        if (bySource.length === 1) {
            return { status: importStatus_1.MatchStatus.MATCHED, matchedBy: 'sourceId', movie: bySource[0], candidates: bySource };
        }
        if (bySource.length > 1) {
            return {
                status: importStatus_1.MatchStatus.AMBIGUOUS,
                matchedBy: 'sourceId',
                candidates: bySource,
                message: `${bySource.length} documents share the same sourceId`,
            };
        }
    }
    // 2. tmdb.id (+ type / season)
    const tmdbId = mapped.tmdb?.id;
    if (tmdbId) {
        const tmdbQuery = { 'tmdb.id': tmdbId };
        if (mapped.tmdb?.type) {
            tmdbQuery['tmdb.type'] = mapped.tmdb.type;
        }
        if (mapped.tmdb?.season !== undefined && mapped.tmdb?.season !== null) {
            tmdbQuery['tmdb.season'] = mapped.tmdb.season;
        }
        const byTmdb = await runQuery(tmdbQuery);
        if (byTmdb.length === 1) {
            return { status: importStatus_1.MatchStatus.MATCHED, matchedBy: 'tmdb', movie: byTmdb[0], candidates: byTmdb };
        }
        if (byTmdb.length > 1) {
            return {
                status: importStatus_1.MatchStatus.AMBIGUOUS,
                matchedBy: 'tmdb',
                candidates: byTmdb,
                message: `${byTmdb.length} documents share the same TMDB identifier`,
            };
        }
    }
    // 3. slug
    if (mapped.slug) {
        const bySlug = await runQuery({ slug: (0, normalizeText_1.normalizeSlug)(mapped.slug) });
        if (bySlug.length === 1) {
            return { status: importStatus_1.MatchStatus.MATCHED, matchedBy: 'slug', movie: bySlug[0], candidates: bySlug };
        }
        if (bySlug.length > 1) {
            return {
                status: importStatus_1.MatchStatus.AMBIGUOUS,
                matchedBy: 'slug',
                candidates: bySlug,
                message: `${bySlug.length} documents share the same slug`,
            };
        }
    }
    // 4. name
    const nameKey = (0, normalizeText_1.normalizeText)(mapped.name);
    if (nameKey) {
        const byName = await runQuery({
            name: { $regex: `^${escapeRegExp(mapped.name ?? '')}$`, $options: 'i' },
        });
        const exact = byName.filter((movie) => (0, normalizeText_1.normalizeText)(movie.name) === nameKey);
        if (exact.length === 1) {
            return { status: importStatus_1.MatchStatus.MATCHED, matchedBy: 'name', movie: exact[0], candidates: exact };
        }
        if (exact.length > 1) {
            return {
                status: importStatus_1.MatchStatus.AMBIGUOUS,
                matchedBy: 'name',
                candidates: exact,
                message: `${exact.length} documents share the same name`,
            };
        }
    }
    // 5. originName
    const originKey = (0, normalizeText_1.normalizeText)(mapped.originName);
    if (originKey && originKey !== nameKey) {
        const byOrigin = await runQuery({
            originName: { $regex: `^${escapeRegExp(mapped.originName ?? '')}$`, $options: 'i' },
        });
        const exact = byOrigin.filter((movie) => (0, normalizeText_1.normalizeText)(movie.originName) === originKey);
        if (exact.length === 1) {
            return {
                status: importStatus_1.MatchStatus.MATCHED,
                matchedBy: 'originName',
                movie: exact[0],
                candidates: exact,
            };
        }
        if (exact.length > 1) {
            return {
                status: importStatus_1.MatchStatus.AMBIGUOUS,
                matchedBy: 'originName',
                candidates: exact,
                message: `${exact.length} documents share the same origin name`,
            };
        }
    }
    return {
        status: importStatus_1.MatchStatus.NEW,
        candidates: [],
        message: 'No document matches this movie yet',
    };
}
//# sourceMappingURL=movieMatcher.service.js.map