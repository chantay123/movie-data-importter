"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSourceFormat = detectSourceFormat;
exports.splitNameList = splitNameList;
exports.normalizeExtractedMovie = normalizeExtractedMovie;
exports.extractMovieDataCandidates = extractMovieDataCandidates;
exports.extractMovieData = extractMovieData;
exports.countExtractedEpisodes = countExtractedEpisodes;
exports.findFirstJsonObject = findFirstJsonObject;
const extraction_types_1 = require("../types/extraction.types");
const jsonScanner_1 = require("../utils/jsonScanner");
const encodingRecovery_1 = require("../utils/encodingRecovery");
/**
 * Extraction of the movie description out of a raw TXT payload.
 *
 * The extractor never parses the whole file as JSON: it first detects the
 * format of the payload, then locates the `movieData` object with a character
 * scanner and only then converts that object into a JavaScript value.
 */
/**
 * Key that holds the main movie description inside the payload.
 */
const MOVIE_DATA_KEY = 'movieData';
/**
 * Keys of the `movieData` object that are consumed by the `Movie` schema.
 *
 * Every other key is reported as an unmapped field so the mapping report
 * stays honest about the data that cannot be stored.
 */
/**
 * Keys of the `movieData` object that the `Movie` schema is able to store.
 *
 * Every other key is reported as an unmapped field so the mapping report
 * stays honest about the data that cannot be written:
 *   - `quality` has no counterpart in the `Movie` schema,
 *   - `view` would map to `viewCount`, which is protected,
 *   - `isChieuRap` would map to `chieurap`, which is protected,
 *   - `typeListId`, `typeList`, `thumbUrlNguonc`, `posterUrlNguonc`,
 *     `logoNameUrl`, `logoNameId`, `previewUrl` and `previewId` have no
 *     counterpart at all.
 */
const MAPPED_MOVIE_KEYS = new Set([
    'id',
    'name',
    'slug',
    'originName',
    'content',
    'type',
    'status',
    'year',
    'thumbUrl',
    'posterUrl',
    'time',
    'episodeCurrent',
    'episodeTotal',
    'trailerUrl',
    'actors',
    'directors',
    'categories',
    'countries',
    'languages',
    'tmdb',
    'sources',
    'notify',
    'showtimes',
]);
/**
 * Placeholder values used by the source when a field is not filled in yet.
 */
const PLACEHOLDER_VALUES = new Set([
    'đang cập nhật',
    'dang cap nhat',
    'updating',
    'n/a',
    'na',
    '-',
    'null',
    'undefined',
]);
/**
 * Detects the format of a raw payload.
 *
 * @param content - Raw text content of the file.
 * @returns The detected format.
 */
function detectSourceFormat(content) {
    if (typeof content !== 'string' || content.trim().length === 0) {
        return extraction_types_1.SourceFormat.UNKNOWN;
    }
    const trimmed = content.trim();
    // A React Flight payload is a list of rows prefixed by an hexadecimal
    // reference, e.g. `25:["$","div",null,{...}]`.
    if (/^[0-9a-f]+:/im.test(trimmed) && trimmed.includes('"$"')) {
        return extraction_types_1.SourceFormat.REACT_FLIGHT;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return extraction_types_1.SourceFormat.JSON_DOCUMENT;
    }
    if (/^\s*<(!doctype|html)/i.test(trimmed)) {
        return extraction_types_1.SourceFormat.HTML;
    }
    // A JSON document embedded in a larger text: the payload starts with a row
    // reference or is surrounded by some text.
    if (trimmed.includes('{') && trimmed.includes('"')) {
        return extraction_types_1.SourceFormat.EMBEDDED_JSON;
    }
    return extraction_types_1.SourceFormat.UNKNOWN;
}
/**
 * Checks whether a value is a usable, non placeholder string.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a usable string.
 */
function isUsableString(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 && !PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}
/**
 * Converts a value into a trimmed string, or `undefined` when unusable.
 *
 * @param value - Value to convert.
 * @returns The trimmed string or `undefined`.
 */
function toTrimmedString(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return isUsableString(value) ? value.trim() : undefined;
}
/**
 * Splits a comma separated list of names.
 *
 * @param value - Raw value, either a string or a list of strings.
 * @returns The list of names.
 */
function splitNameList(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => {
            if ((0, jsonScanner_1.isPlainObject)(entry)) {
                return toTrimmedString(entry['name']);
            }
            return toTrimmedString(entry);
        })
            .filter((entry) => Boolean(entry));
    }
    const raw = toTrimmedString(value);
    if (!raw) {
        return [];
    }
    return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
/**
 * Converts a list of raw entities into the normalized named entity list.
 *
 * @param value - Raw list, either plain strings or objects carrying a name.
 * @returns The list of named entities.
 */
function toNamedEntities(value) {
    if (!Array.isArray(value)) {
        const single = toTrimmedString(value);
        return single ? [{ name: single }] : [];
    }
    const result = [];
    for (const entry of value) {
        if ((0, jsonScanner_1.isPlainObject)(entry)) {
            const name = toTrimmedString(entry['name']);
            if (!name) {
                continue;
            }
            const entity = { name };
            const slug = toTrimmedString(entry['slug']);
            if (slug) {
                entity.slug = slug;
            }
            const id = toTrimmedString(entry['id']);
            if (id) {
                entity.id = id;
            }
            result.push(entity);
            continue;
        }
        const name = toTrimmedString(entry);
        if (name) {
            result.push({ name });
        }
    }
    return result;
}
/**
 * Normalizes the episodes of a language group.
 *
 * @param value - Raw episodes list.
 * @returns The normalized episodes, in their original order.
 */
function toEpisodes(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const episodes = [];
    for (const entry of value) {
        if (!(0, jsonScanner_1.isPlainObject)(entry)) {
            continue;
        }
        const episode = {};
        const name = toTrimmedString(entry['name']);
        if (name) {
            episode.name = name;
        }
        const slug = toTrimmedString(entry['slug']);
        if (slug) {
            episode.slug = slug;
        }
        const episodeNumber = Number(entry['episodeNumber'] ?? entry['episode_number']);
        if (Number.isInteger(episodeNumber)) {
            episode.episodeNumber = episodeNumber;
        }
        const linkEmbed = toTrimmedString(entry['linkEmbed'] ?? entry['link_embed']);
        if (linkEmbed) {
            episode.linkEmbed = linkEmbed;
        }
        const linkM3u8 = toTrimmedString(entry['linkM3u8'] ?? entry['link_m3u8']);
        if (linkM3u8) {
            episode.linkM3u8 = linkM3u8;
        }
        const linkDirect = toTrimmedString(entry['linkDirect'] ?? entry['link_direct']);
        if (linkDirect) {
            episode.linkDirect = linkDirect;
        }
        // An episode without a name and without a slug cannot be identified and
        // would be rejected by the MongoDB schema.
        if (!episode.name && !episode.slug) {
            continue;
        }
        episodes.push(episode);
    }
    return episodes;
}
/**
 * Normalizes the language groups of a server.
 *
 * @param value - Raw languages list.
 * @returns The normalized language groups.
 */
function toLanguages(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const languages = [];
    for (const entry of value) {
        if (!(0, jsonScanner_1.isPlainObject)(entry)) {
            continue;
        }
        const language = { episodes: [] };
        const name = toTrimmedString(entry['name']);
        if (name) {
            language.name = name;
        }
        const slug = toTrimmedString(entry['slug']);
        if (slug) {
            language.slug = slug;
        }
        const key = toTrimmedString(entry['key']);
        if (key) {
            language.key = key;
        }
        language.episodes = toEpisodes(entry['episodes']);
        languages.push(language);
    }
    return languages;
}
/**
 * Normalizes the streaming servers of a movie.
 *
 * @param value - Raw sources list.
 * @returns The normalized servers.
 */
function toSources(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const sources = [];
    for (const entry of value) {
        if (!(0, jsonScanner_1.isPlainObject)(entry)) {
            continue;
        }
        const source = { languages: [] };
        const serverName = toTrimmedString(entry['serverName'] ?? entry['server_name']);
        if (serverName) {
            source.serverName = serverName;
        }
        const serverKey = toTrimmedString(entry['serverKey'] ?? entry['server_key']);
        if (serverKey) {
            source.serverKey = serverKey;
        }
        source.languages = toLanguages(entry['languages']);
        // A server without a name cannot be stored: `server_name` is required by
        // the MongoDB schema.
        if (!source.serverName) {
            continue;
        }
        sources.push(source);
    }
    return sources;
}
/**
 * Normalizes the TMDB identifiers of a movie.
 *
 * @param value - Raw TMDB object.
 * @returns The normalized TMDB payload or `undefined`.
 */
function toTmdb(value) {
    if (!(0, jsonScanner_1.isPlainObject)(value)) {
        return undefined;
    }
    const tmdb = {};
    const id = toTrimmedString(value['id']);
    if (id) {
        tmdb.id = id;
    }
    const tmdbId = toTrimmedString(value['tmdbId'] ?? value['tmdb_id']);
    if (tmdbId) {
        tmdb.tmdbId = tmdbId;
    }
    const type = toTrimmedString(value['type']);
    if (type) {
        tmdb.type = type;
    }
    const season = Number(value['season']);
    if (Number.isInteger(season)) {
        tmdb.season = season;
    }
    const voteAverage = Number(value['voteAverage'] ?? value['vote_average']);
    if (Number.isFinite(voteAverage)) {
        tmdb.voteAverage = voteAverage;
    }
    const voteCount = Number(value['voteCount'] ?? value['vote_count']);
    if (Number.isFinite(voteCount)) {
        tmdb.voteCount = voteCount;
    }
    return Object.keys(tmdb).length > 0 ? tmdb : undefined;
}
/**
 * Converts a raw `movieData` object into the normalized description.
 *
 * @param raw - Raw `movieData` object.
 * @returns The normalized movie description.
 */
function normalizeExtractedMovie(raw) {
    const data = { sources: [], unmappedFields: [] };
    const id = toTrimmedString(raw['id']);
    if (id) {
        data.id = id;
    }
    const name = toTrimmedString(raw['name']);
    if (name) {
        data.name = name;
    }
    const slug = toTrimmedString(raw['slug']);
    if (slug) {
        data.slug = slug;
    }
    const originName = toTrimmedString(raw['originName']);
    if (originName) {
        data.originName = originName;
    }
    const content = toTrimmedString(raw['content']);
    if (content) {
        data.content = content;
    }
    const type = toTrimmedString(raw['type']);
    if (type) {
        data.type = type;
    }
    const status = toTrimmedString(raw['status']);
    if (status) {
        data.status = status;
    }
    const year = Number(raw['year']);
    if (Number.isInteger(year) && year > 1000 && year < 3000) {
        data.year = year;
    }
    const thumbUrl = toTrimmedString(raw['thumbUrl']);
    if (thumbUrl) {
        data.thumbUrl = thumbUrl;
    }
    const posterUrl = toTrimmedString(raw['posterUrl']);
    if (posterUrl) {
        data.posterUrl = posterUrl;
    }
    const time = toTrimmedString(raw['time']);
    if (time) {
        data.time = time;
    }
    const episodeCurrent = toTrimmedString(raw['episodeCurrent']);
    if (episodeCurrent) {
        data.episodeCurrent = episodeCurrent;
    }
    const episodeTotal = toTrimmedString(raw['episodeTotal']);
    if (episodeTotal) {
        data.episodeTotal = episodeTotal;
    }
    const quality = toTrimmedString(raw['quality']);
    if (quality) {
        data.quality = quality;
    }
    const view = Number(raw['view']);
    if (Number.isFinite(view)) {
        data.view = view;
    }
    if (typeof raw['isChieuRap'] === 'boolean') {
        data.isChieuRap = raw['isChieuRap'];
    }
    const trailerUrl = toTrimmedString(raw['trailerUrl']);
    if (trailerUrl) {
        data.trailerUrl = trailerUrl;
    }
    const notify = toTrimmedString(raw['notify']);
    if (notify) {
        data.notify = notify;
    }
    const showtimes = toTrimmedString(raw['showtimes']);
    if (showtimes) {
        data.showtimes = showtimes;
    }
    const actors = splitNameList(raw['actors']);
    if (actors.length > 0) {
        data.actors = actors;
    }
    const directors = splitNameList(raw['directors'] ?? raw['director']);
    if (directors.length > 0) {
        data.directors = directors;
    }
    const categories = toNamedEntities(raw['categories'] ?? raw['category']);
    if (categories.length > 0) {
        data.categories = categories;
    }
    const countries = toNamedEntities(raw['countries'] ?? raw['country']);
    if (countries.length > 0) {
        data.countries = countries;
    }
    const languages = toNamedEntities(raw['languages']);
    if (languages.length > 0) {
        data.languages = languages;
    }
    const tmdb = toTmdb(raw['tmdb']);
    if (tmdb) {
        data.tmdb = tmdb;
    }
    data.sources = toSources(raw['sources']);
    for (const key of Object.keys(raw)) {
        if (!MAPPED_MOVIE_KEYS.has(key)) {
            data.unmappedFields.push(key);
        }
    }
    return data;
}
/**
 * Extracts the cast members and the backdrops of the standalone TMDB payload.
 *
 * The TMDB object that sits next to the `movieData` object in the page carries
 * the detailed cast. It is only used to enrich the movie that was extracted
 * from the `movieData` object.
 *
 * @param content - Raw text content of the file.
 * @param movie - The movie extracted from the `movieData` object.
 * @returns The enriched movie.
 */
function enrichWithStandaloneTmdb(content, movie) {
    const ranges = (0, jsonScanner_1.findObjectsByKey)(content, 'tmdb');
    for (const range of ranges) {
        const parsed = (0, jsonScanner_1.parseJsonSlice)(content.slice(range.start, range.end));
        if (!(0, jsonScanner_1.isPlainObject)(parsed)) {
            continue;
        }
        // The standalone TMDB payload carries the cast, the backdrops and the
        // list of similar movies. The `movieData` object only carries identifiers.
        if (!Array.isArray(parsed['cast']) && !Array.isArray(parsed['backdrops'])) {
            continue;
        }
        if (Array.isArray(parsed['cast'])) {
            const cast = parsed['cast']
                .map((entry) => {
                if (!(0, jsonScanner_1.isPlainObject)(entry)) {
                    return undefined;
                }
                const name = toTrimmedString(entry['name']);
                if (!name) {
                    return undefined;
                }
                const member = { name };
                const character = toTrimmedString(entry['character']);
                if (character) {
                    member.character = character;
                }
                return member;
            })
                .filter((entry) => Boolean(entry));
            if (cast.length > 0) {
                movie.cast = cast;
            }
        }
        if (Array.isArray(parsed['backdrops'])) {
            const backdrops = parsed['backdrops']
                .map((entry) => {
                if (!(0, jsonScanner_1.isPlainObject)(entry)) {
                    return undefined;
                }
                return toTrimmedString(entry['file_path']);
            })
                .filter((entry) => Boolean(entry));
            if (backdrops.length > 0) {
                movie.backdrops = backdrops;
            }
        }
        break;
    }
    return movie;
}
/**
 * Extracts every `movieData` object of a payload.
 *
 * @param content - Raw text content of the file.
 * @returns The list of the extracted movies.
 */
function extractMovieDataCandidates(content) {
    const ranges = (0, jsonScanner_1.findObjectsByKey)(content, MOVIE_DATA_KEY);
    const candidates = [];
    for (const range of ranges) {
        const parsed = (0, jsonScanner_1.parseJsonSlice)(content.slice(range.start, range.end));
        if (!(0, jsonScanner_1.isPlainObject)(parsed)) {
            continue;
        }
        candidates.push(normalizeExtractedMovie((0, encodingRecovery_1.recoverDeep)(parsed)));
    }
    return candidates;
}
/**
 * Extracts the movie description out of a raw TXT payload.
 *
 * The function never throws: a failure is reported through the returned
 * result so that one broken file cannot stop a whole batch.
 *
 * @param content - Raw text content of the file.
 * @returns The extraction result.
 */
function extractMovieData(content) {
    if (typeof content !== 'string' || content.trim().length === 0) {
        return {
            success: false,
            format: extraction_types_1.SourceFormat.UNKNOWN,
            candidates: [],
            message: 'The file is empty',
        };
    }
    const format = detectSourceFormat(content);
    // A plain JSON document is handled by the legacy parser: the payload is the
    // movie itself.
    if (format === extraction_types_1.SourceFormat.JSON_DOCUMENT) {
        return {
            success: false,
            format,
            candidates: [],
            message: 'The file contains a plain JSON document. It is handled by the standard JSON pipeline.',
        };
    }
    const candidates = extractMovieDataCandidates(content);
    if (candidates.length === 0) {
        return {
            success: false,
            format,
            candidates: [],
            message: `No "${MOVIE_DATA_KEY}" object could be found in the file`,
        };
    }
    // The main movie is the candidate that carries the most identifying data.
    // A candidate without a name and without a slug is never the main movie.
    const scored = candidates
        .map((candidate, index) => ({
        candidate,
        index,
        score: scoreCandidate(candidate),
    }))
        .sort((left, right) => right.score - left.score || left.index - right.index);
    const best = scored[0];
    if (!best || best.score === 0) {
        return {
            success: false,
            format,
            candidates,
            message: `The "${MOVIE_DATA_KEY}" objects found in the file carry no identifying data`,
        };
    }
    const movie = enrichWithStandaloneTmdb(content, best.candidate);
    // Several candidates with the same score means the main movie cannot be
    // determined with certainty: the user has to review the file.
    const ambiguous = scored.filter((entry) => entry.score === best.score).length > 1;
    if (ambiguous) {
        return {
            success: false,
            format,
            candidates,
            message: `Several "${MOVIE_DATA_KEY}" objects with the same data were found, the main movie cannot be determined`,
        };
    }
    return {
        success: true,
        format,
        data: movie,
        candidates,
        message: `The movie "${movie.name ?? movie.slug ?? 'unknown'}" was extracted`,
    };
}
/**
 * Scores a candidate to identify the main movie of a page.
 *
 * @param candidate - Candidate to score.
 * @returns The score, the higher the more likely it is the main movie.
 */
function scoreCandidate(candidate) {
    let score = 0;
    if (candidate.name) {
        score += 10;
    }
    if (candidate.slug) {
        score += 10;
    }
    if (candidate.originName) {
        score += 3;
    }
    if (candidate.sources.length > 0) {
        score += 5;
    }
    if (candidate.tmdb) {
        score += 2;
    }
    if (candidate.content) {
        score += 1;
    }
    return score;
}
/**
 * Counts the servers and the episodes carried by an extracted movie.
 *
 * @param movie - Extracted movie.
 * @returns The number of servers and of episodes.
 */
function countExtractedEpisodes(movie) {
    let servers = 0;
    let episodes = 0;
    for (const source of movie.sources) {
        servers += 1;
        for (const language of source.languages) {
            episodes += language.episodes.length;
        }
    }
    return { servers, episodes };
}
/**
 * Locates the boundaries of the first JSON object of a text payload.
 *
 * @param content - Raw text content.
 * @returns The range of the object or `null` when none could be found.
 */
function findFirstJsonObject(content) {
    const index = content.indexOf('{');
    if (index === -1) {
        return null;
    }
    return (0, jsonScanner_1.findObjectEnd)(content, index);
}
//# sourceMappingURL=extraction.service.js.map