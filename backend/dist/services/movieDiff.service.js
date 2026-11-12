"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTECTED_FIELDS = void 0;
exports.diffMovie = diffMovie;
exports.buildComparison = buildComparison;
exports.mergeEpisodes = mergeEpisodes;
exports.mergeStringArray = mergeStringArray;
const importStatus_1 = require("../constants/importStatus");
const normalizeText_1 = require("../utils/normalizeText");
/**
 * Field level comparison between the database document and the incoming data.
 *
 * The rules implemented here are the safety core of the importer:
 *   - a field that is missing from the TXT file is never written,
 *   - an invalid value never overwrites a valid database value,
 *   - array fields are merged instead of being replaced by default.
 */
/**
 * Fields of the `Movie` schema that are never written by the importer.
 */
exports.PROTECTED_FIELDS = new Set([
    '_id',
    'createdAt',
    'updatedAt',
    '__v',
    'viewCount',
    'rating',
    'statCd',
    'dateLastMain',
    'effDate',
    'notifySubscribers',
    'isCopyright',
    'chieurap',
    'subDocquyen',
]);
/**
 * Fields that use the union merge strategy instead of a plain replacement.
 */
const ARRAY_MERGE_FIELDS = new Set(['actor', 'director']);
/**
 * Compares two nested objects, ignoring the keys that the importer never
 * writes and the keys that are absent from the incoming payload.
 *
 * The `trailer` and the `tmdb` objects of the `Movie` schema carry several
 * fields managed by the crawler (view count, vote average, name, site, ...).
 * Comparing them as-is would report a change on every import, and replacing
 * them would erase the data of the crawler. Only the keys carried by the
 * incoming payload are therefore compared.
 *
 * @param left - First value.
 * @param right - Second value.
 * @param managedKeys - Keys the importer is allowed to write.
 * @returns `true` when both objects hold the same managed values.
 */
function isSameManagedObject(left, right, managedKeys) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return left === right;
    }
    const leftRecord = left;
    const rightRecord = right;
    for (const key of Object.keys(rightRecord)) {
        if (!managedKeys.has(key)) {
            continue;
        }
        const rightValue = rightRecord[key];
        const leftValue = leftRecord[key];
        if (rightValue === undefined || rightValue === null) {
            continue;
        }
        if (leftValue === undefined || leftValue === null) {
            return false;
        }
        if (!isSameValue(leftValue, rightValue)) {
            return false;
        }
    }
    return true;
}
/**
 * Fields of the `trailer` object the importer is allowed to write.
 */
const MANAGED_TRAILER_KEYS = new Set(['url', 'key', 'name', 'site', 'type']);
/**
 * Fields of the `tmdb` object the importer is allowed to write.
 */
const MANAGED_TMDB_KEYS = new Set(['id', 'type', 'season']);
/**
 * Compares two primitive values.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns `true` when both values are equivalent.
 */
function isSameValue(left, right) {
    if (left === right) {
        return true;
    }
    if (left instanceof Date || right instanceof Date) {
        const leftTime = left instanceof Date ? left.getTime() : new Date(String(left)).getTime();
        const rightTime = right instanceof Date ? right.getTime() : new Date(String(right)).getTime();
        return leftTime === rightTime;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            return false;
        }
        return left.every((item, index) => isSameValue(item, right[index]));
    }
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        if (leftKeys.length !== rightKeys.length) {
            return false;
        }
        return leftKeys.every((key, index) => key === rightKeys[index] &&
            isSameValue(left[key], right[key]));
    }
    return false;
}
/**
 * Compares two arrays of strings, ignoring the order and the case.
 *
 * @param left - First array.
 * @param right - Second array.
 * @returns `true` when both arrays contain the same values.
 */
function isSameStringSet(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return false;
    }
    if (left.length !== right.length) {
        return false;
    }
    const normalize = (values) => values.map((value) => (0, normalizeText_1.normalizeText)(String(value ?? ''))).sort();
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
/**
 * Checks whether two episode server lists describe the same episodes.
 *
 * @param left - First list of servers.
 * @param right - Second list of servers.
 * @returns `true` when both lists contain the same servers and episodes.
 */
function isSameEpisodeSet(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return false;
    }
    if (left.length !== right.length) {
        return false;
    }
    const summarize = (servers) => servers
        .map((server) => `${server.server_name.toLowerCase()}:${server.server_data
        .map((episode) => episode.slug.toLowerCase())
        .join(',')}`)
        .sort();
    const summarizedLeft = summarize(left);
    const summarizedRight = summarize(right);
    return summarizedLeft.every((value, index) => value === summarizedRight[index]);
}
/**
 * Builds the comparison of a single field.
 *
 * @param field - Name of the field.
 * @param currentValue - Value stored in MongoDB.
 * @param incomingValue - Value coming from the TXT file.
 * @returns The comparison of the field.
 */
function compareField(field, currentValue, incomingValue) {
    const isProtected = exports.PROTECTED_FIELDS.has(field);
    if (isProtected) {
        return {
            field,
            currentValue,
            incomingValue,
            status: importStatus_1.FieldStatus.CONFLICT,
            isProtected: true,
            message: 'This field is protected and is never written by the importer',
        };
    }
    if (incomingValue === undefined || incomingValue === null) {
        return {
            field,
            currentValue,
            incomingValue,
            status: importStatus_1.FieldStatus.MISSING,
            isProtected,
            message: 'The source file does not contain this field, the database value is kept',
        };
    }
    const same = field === 'episodes'
        ? isSameEpisodeSet(currentValue, incomingValue)
        : field === 'actor' || field === 'director'
            ? isSameStringSet(currentValue, incomingValue)
            : field === 'trailer'
                ? isSameManagedObject(currentValue, incomingValue, MANAGED_TRAILER_KEYS)
                : field === 'tmdb'
                    ? isSameManagedObject(currentValue, incomingValue, MANAGED_TMDB_KEYS)
                    : isSameValue(currentValue, incomingValue);
    if (same) {
        return {
            field,
            currentValue,
            incomingValue,
            status: importStatus_1.FieldStatus.UNCHANGED,
            isProtected,
            message: 'The database already contains the same value',
        };
    }
    const mergeStrategy = ARRAY_MERGE_FIELDS.has(field) || field === 'episodes'
        ? importStatus_1.MergeStrategy.UNION
        : importStatus_1.MergeStrategy.REPLACE;
    return {
        field,
        currentValue,
        incomingValue,
        status: importStatus_1.FieldStatus.CHANGED,
        mergeStrategy,
        isProtected,
        message: mergeStrategy === importStatus_1.MergeStrategy.UNION
            ? 'The incoming values are merged with the existing ones'
            : 'The database value will be replaced by the incoming one',
    };
}
/**
 * Compares a mapped movie with the document stored in MongoDB.
 *
 * @param mapped - The mapped movie coming from the TXT file.
 * @param existing - The document found in MongoDB (undefined for a new movie).
 * @returns The list of field level comparisons.
 */
function diffMovie(mapped, existing) {
    const diffs = [];
    const simpleFields = [
        'name',
        'originName',
        'content',
        'slug',
        'sourceId',
        'releaseDate',
        'status',
        'time',
        'episodeCurrent',
        'episodeTotal',
        'lang',
        'thumbUrl',
        'posterUrl',
        'notify',
        'showtimes',
        'trailer',
        'tmdb',
    ];
    for (const field of simpleFields) {
        const incomingValue = mapped[field];
        const currentValue = existing
            ? existing[field]
            : undefined;
        diffs.push(compareField(field, currentValue, incomingValue));
    }
    diffs.push(compareField('actor', existing?.actor, mapped.actor));
    diffs.push(compareField('director', existing?.director, mapped.director));
    diffs.push(compareField('episodes', existing?.episodes, mapped.episodes));
    // The protected fields are always listed so the user can see that the
    // importer deliberately leaves them untouched.
    for (const field of exports.PROTECTED_FIELDS) {
        if (diffs.some((diff) => diff.field === field)) {
            continue;
        }
        diffs.push(compareField(field, existing ? existing[field] : undefined, undefined));
    }
    return diffs;
}
/**
 * Builds the complete comparison of a movie.
 *
 * @param fileId - Identifier of the file the comparison belongs to.
 * @param mapped - The mapped movie coming from the TXT file.
 * @param match - The result of the database lookup.
 * @returns The comparison, including the fields that can safely be written.
 */
function buildComparison(fileId, mapped, match) {
    const diffs = diffMovie(mapped, match.movie);
    const isNew = match.status === importStatus_1.MatchStatus.NEW || !match.movie;
    const updatableFields = diffs
        .filter((diff) => {
        if (diff.isProtected) {
            return false;
        }
        if (isNew) {
            // A brand new document receives every field that carries a usable value.
            return diff.status === importStatus_1.FieldStatus.CHANGED || diff.status === importStatus_1.FieldStatus.UNCHANGED;
        }
        return diff.status === importStatus_1.FieldStatus.CHANGED;
    })
        .map((diff) => diff.field);
    return {
        fileId,
        matchStatus: match.status,
        matchedBy: match.matchedBy,
        existing: match.movie,
        candidates: match.candidates,
        diffs,
        updatableFields,
    };
}
/**
 * Merges the incoming episodes with the episodes already stored in MongoDB.
 *
 * The merge is performed server by server and episode by episode:
 *   - a server that does not exist yet is added as a whole,
 *   - an existing server keeps its episodes and gains the missing ones,
 *   - an episode that already exists is updated in place (its `_id` is kept),
 *   - no episode is ever removed.
 *
 * @param existing - Episodes currently stored in MongoDB.
 * @param incoming - Episodes coming from the TXT file.
 * @returns The merged episodes and the counters of added / updated episodes.
 */
function mergeEpisodes(existing, incoming) {
    const result = (existing ?? []).map((server) => ({
        server_name: server.server_name,
        server_data: server.server_data.map((episode) => ({ ...episode })),
    }));
    if (!incoming || incoming.length === 0) {
        return { episodes: result, added: 0, updated: 0 };
    }
    let added = 0;
    let updated = 0;
    for (const incomingServer of incoming) {
        const serverName = incomingServer.server_name.toLowerCase();
        const existingServer = result.find((server) => server.server_name.toLowerCase() === serverName);
        if (!existingServer) {
            result.push({
                server_name: incomingServer.server_name,
                server_data: incomingServer.server_data.map((episode) => ({ ...episode })),
            });
            added += incomingServer.server_data.length;
            continue;
        }
        for (const incomingEpisode of incomingServer.server_data) {
            const existingEpisode = existingServer.server_data.find((episode) => episode.slug.toLowerCase() === incomingEpisode.slug.toLowerCase());
            if (!existingEpisode) {
                existingServer.server_data.push({ ...incomingEpisode });
                added += 1;
                continue;
            }
            // The episode already exists: refresh its links but keep its identity.
            let changed = false;
            if (incomingEpisode.link_embed &&
                incomingEpisode.link_embed !== existingEpisode.link_embed) {
                existingEpisode.link_embed = incomingEpisode.link_embed;
                changed = true;
            }
            if (incomingEpisode.link_m3u8 && incomingEpisode.link_m3u8 !== existingEpisode.link_m3u8) {
                existingEpisode.link_m3u8 = incomingEpisode.link_m3u8;
                changed = true;
            }
            if (incomingEpisode.name && incomingEpisode.name !== existingEpisode.name) {
                existingEpisode.name = incomingEpisode.name;
                changed = true;
            }
            if (incomingEpisode.filename && incomingEpisode.filename !== existingEpisode.filename) {
                existingEpisode.filename = incomingEpisode.filename;
                changed = true;
            }
            if (changed) {
                updated += 1;
            }
        }
    }
    return { episodes: result, added, updated };
}
/**
 * Merges two arrays of strings without removing the existing entries.
 *
 * @param existing - Values currently stored in MongoDB.
 * @param incoming - Values coming from the TXT file.
 * @returns The merged list.
 */
function mergeStringArray(existing, incoming) {
    const result = [...(existing ?? [])];
    const seen = new Set(result.map((value) => (0, normalizeText_1.normalizeText)(value)));
    for (const value of incoming ?? []) {
        const key = (0, normalizeText_1.normalizeText)(value);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(value);
        }
    }
    return result;
}
//# sourceMappingURL=movieDiff.service.js.map