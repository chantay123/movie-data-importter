"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractYoutubeKey = extractYoutubeKey;
exports.buildServerGroupName = buildServerGroupName;
exports.toEpisodeServers = toEpisodeServers;
exports.isValidUrl = isValidUrl;
exports.mapTrailer = mapTrailer;
exports.mapTmdb = mapTmdb;
exports.mapReleaseDate = mapReleaseDate;
exports.mapExtractedMovie = mapExtractedMovie;
exports.mapMovie = mapMovie;
exports.toMovieDocument = toMovieDocument;
/**
 * Converts a raw payload into the shape expected by the MongoDB `Movie` model.
 *
 * The rule is strict: a field is only emitted when the source payload
 * actually contains a usable value. Missing fields are never replaced by
 * `null`, an empty string, `0` or `false`.
 */
/**
 * Maximum number of characters accepted for the free text fields.
 */
const MAX_TEXT_LENGTH = 500;
/**
 * Checks that a value is a non empty string.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a string with at least one non space character.
 */
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
/**
 * Converts an arbitrary value into a trimmed string, or `undefined` when unusable.
 *
 * @param value - Value to convert.
 * @returns The trimmed string or `undefined`.
 */
function toTrimmedString(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return isNonEmptyString(value) ? value.trim() : undefined;
}
/**
 * Converts a value into a string usable for a numeric-like field.
 *
 * The `Movie` model stores `episodeCurrent`, `episodeTotal` and `time` as
 * strings, therefore the number is stringified here.
 *
 * @param value - Value to convert.
 * @returns The stringified value or `undefined`.
 */
function toNumericString(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    return undefined;
}
/**
 * Extracts a list of names carried by a field that can be a string or a list.
 *
 * @param values - Raw value, either a single string or an array of strings.
 * @returns The list of trimmed names.
 */
function toNamedStringList(values) {
    if (isNonEmptyString(values)) {
        return [values.trim()];
    }
    if (!Array.isArray(values)) {
        return [];
    }
    return values
        .map((value) => toTrimmedString(value))
        .filter((value) => Boolean(value));
}
/**
 * Extracts the list of names carried by the `categories` / `countries` fields.
 *
 * @param values - Raw list, either plain strings or objects with a name.
 * @returns The list of `{ name, slug }` pairs.
 */
function toNamedList(values) {
    if (!Array.isArray(values)) {
        return [];
    }
    const result = [];
    for (const value of values) {
        if (isNonEmptyString(value)) {
            result.push({ name: value.trim(), slug: '' });
            continue;
        }
        if (typeof value === 'object' && value !== null) {
            const entry = value;
            const name = toTrimmedString(entry.name);
            if (name) {
                result.push({ name, slug: toTrimmedString(entry.slug) ?? '' });
            }
        }
    }
    return result;
}
/**
 * Extracts the YouTube video key from a trailer URL.
 *
 * @param url - Trailer URL.
 * @returns The video key or `undefined` when the URL is not a YouTube link.
 */
function extractYoutubeKey(url) {
    const patterns = [
        /youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,})/i,
        /youtu\.be\/([\w-]{6,})/i,
        /youtube\.com\/embed\/([\w-]{6,})/i,
        /youtube\.com\/shorts\/([\w-]{6,})/i,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(url);
        if (match?.[1]) {
            return match[1];
        }
    }
    return undefined;
}
/**
 * Normalizes the whitespace of a label coming from the source payload.
 *
 * Some payloads embed the language name inside a template that leaves a line
 * break and a run of spaces in the middle of the label, e.g.
 * `Vietsub\n                        #1`.
 *
 * @param value - Label to normalize.
 * @returns The normalized label.
 */
function collapseWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
/**
 * Builds the name of a server group from its name and its language.
 *
 * The `Movie` schema stores one group per server, therefore a server that
 * exposes several languages is split into one group per language. The name of
 * the group keeps the name of the server and the name of the language, e.g.
 * `NguonC - Thuyết minh #1`.
 *
 * @param serverName - Name of the server.
 * @param languageName - Name of the language.
 * @returns The name of the group.
 */
function buildServerGroupName(serverName, languageName) {
    const server = collapseWhitespace(serverName);
    const language = languageName ? collapseWhitespace(languageName) : '';
    if (!language) {
        return server;
    }
    // The language is already part of the server name in some payloads
    // (`Vietsub #1`): in that case the name is kept as it is.
    if (server.toLowerCase().includes(language.toLowerCase())) {
        return server;
    }
    return `${server} - ${language}`;
}
/**
 * Converts the extracted episodes into the MongoDB episode entries.
 *
 * @param episodes - Extracted episodes.
 * @returns The MongoDB episode entries, in their original order.
 */
function toEpisodeEntries(episodes) {
    const entries = [];
    const seen = new Set();
    for (const episode of episodes) {
        const name = episode.name ? collapseWhitespace(episode.name) : '';
        const slug = episode.slug ? collapseWhitespace(episode.slug) : '';
        // `name` and `slug` are required by the MongoDB schema.
        if (!name || !slug) {
            continue;
        }
        const key = slug.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        entries.push({
            name,
            slug,
            filename: slug,
            link_embed: toTrimmedString(episode.linkEmbed) ?? '',
            link_m3u8: toTrimmedString(episode.linkM3u8) ?? '',
        });
    }
    return entries;
}
/**
 * Converts the extracted servers into the MongoDB episode servers.
 *
 * Every language of a server becomes its own group: the episodes of two
 * different languages are never merged together.
 *
 * @param sources - Extracted servers.
 * @returns The MongoDB episode servers.
 */
function toEpisodeServers(sources) {
    const servers = [];
    for (const source of sources) {
        const serverName = source.serverName ? collapseWhitespace(source.serverName) : '';
        if (!serverName) {
            continue;
        }
        const languages = source.languages;
        // A server without any language group keeps its episodes at the top level.
        if (languages.length === 0) {
            servers.push({ server_name: serverName, server_data: [] });
            continue;
        }
        const usedNames = new Set();
        for (const language of languages) {
            const groupName = buildServerGroupName(serverName, language.name);
            // Two languages of the same server can end up with the same name once
            // the whitespace is normalized: a numeric suffix disambiguates them.
            let uniqueName = groupName;
            let suffix = 2;
            while (usedNames.has(uniqueName.toLowerCase())) {
                uniqueName = `${groupName} #${suffix}`;
                suffix += 1;
            }
            usedNames.add(uniqueName.toLowerCase());
            servers.push({
                server_name: uniqueName,
                server_data: toEpisodeEntries(language.episodes),
            });
        }
    }
    return servers;
}
/**
 * Normalizes the episodes of the raw payload.
 *
 * The original order of the servers and of their episodes is preserved and
 * duplicated episodes (same slug inside the same server) are removed.
 *
 * @param sources - Raw `sources` array.
 * @returns The normalized episode servers.
 */
function mapEpisodes(sources) {
    if (!Array.isArray(sources)) {
        return [];
    }
    const servers = [];
    const seenServers = new Set();
    for (const rawServer of sources) {
        if (typeof rawServer !== 'object' || rawServer === null) {
            continue;
        }
        const server = rawServer;
        const serverName = toTrimmedString(server.server_name);
        if (!serverName) {
            continue;
        }
        const serverKey = serverName.toLowerCase();
        if (seenServers.has(serverKey)) {
            continue;
        }
        seenServers.add(serverKey);
        const rawEpisodes = Array.isArray(server.server_data) ? server.server_data : [];
        const episodes = [];
        const seenEpisodes = new Set();
        for (const rawEpisode of rawEpisodes) {
            if (typeof rawEpisode !== 'object' || rawEpisode === null) {
                continue;
            }
            const episode = rawEpisode;
            const name = toTrimmedString(episode.name);
            const slug = toTrimmedString(episode.slug);
            const filename = toTrimmedString(episode.filename);
            // `name` and `slug` are required by the MongoDB schema: an episode
            // without them cannot be written and is therefore skipped.
            if (!name || !slug) {
                continue;
            }
            const episodeKey = slug.toLowerCase();
            if (seenEpisodes.has(episodeKey)) {
                continue;
            }
            seenEpisodes.add(episodeKey);
            episodes.push({
                name,
                slug,
                filename: filename ?? slug,
                link_embed: toTrimmedString(episode.link_embed) ?? '',
                link_m3u8: toTrimmedString(episode.link_m3u8) ?? '',
            });
        }
        servers.push({ server_name: serverName, server_data: episodes });
    }
    return servers;
}
/**
 * Checks that a value is a usable absolute URL.
 *
 * @param value - URL to validate.
 * @returns `true` when the value is a valid http(s) URL.
 */
function isValidUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
/**
 * Maps the trailer information of the raw payload.
 *
 * A trailer is only produced when the source provides a usable URL or key.
 * No name, publication date, view count or "official" flag is invented.
 *
 * @param raw - Raw trailer object.
 * @param info - Raw `info` block, used as a fallback for the trailer URL.
 * @returns The trailer payload or `undefined` when there is nothing usable.
 */
function mapTrailer(raw, info) {
    const candidateUrl = toTrimmedString(raw?.url) ?? toTrimmedString(info?.trailerUrl);
    const rawUrl = candidateUrl && isValidUrl(candidateUrl) ? candidateUrl : undefined;
    const rawKey = toTrimmedString(raw?.key);
    if (!rawUrl && !rawKey) {
        return undefined;
    }
    const key = rawKey ?? (rawUrl ? extractYoutubeKey(rawUrl) : undefined);
    const url = rawUrl ?? (key ? `https://www.youtube.com/watch?v=${key}` : undefined);
    if (!key && !url) {
        return undefined;
    }
    const trailer = {};
    if (url) {
        trailer.url = url;
    }
    if (key) {
        trailer.key = key;
    }
    const name = toTrimmedString(raw?.name);
    if (name) {
        trailer.name = name;
    }
    const site = toTrimmedString(raw?.site);
    if (site) {
        trailer.site = site;
    }
    const type = toTrimmedString(raw?.type);
    if (type) {
        trailer.type = type;
    }
    if (typeof raw?.official === 'boolean') {
        trailer.official = raw.official;
    }
    if (raw?.publishedAt) {
        const publishedAt = new Date(raw.publishedAt);
        if (!Number.isNaN(publishedAt.getTime())) {
            trailer.publishedAt = publishedAt;
        }
    }
    return trailer;
}
/**
 * Maps the TMDB identifiers of the raw payload.
 *
 * @param raw - Raw TMDB object.
 * @returns The TMDB payload or `undefined` when nothing usable is present.
 */
function mapTmdb(raw) {
    if (!raw) {
        return undefined;
    }
    const id = toTrimmedString(raw.id);
    const type = toTrimmedString(raw.type);
    if (!id && !type) {
        return undefined;
    }
    const tmdb = {};
    if (id) {
        tmdb.id = id;
    }
    if (type) {
        tmdb.type = type;
    }
    const season = Number.parseInt(String(raw.season ?? ''), 10);
    if (Number.isInteger(season)) {
        tmdb.season = season;
    }
    return tmdb;
}
/**
 * Converts a release year into a date.
 *
 * Only the first day of January of that year is used, in UTC, so the importer
 * never invents a day or a month that is not present in the source data.
 *
 * @param year - Release year carried by the payload.
 * @returns The date or `undefined` when the year is missing or invalid.
 */
function mapReleaseDate(year) {
    if (year === undefined || year === null || year === '') {
        return undefined;
    }
    const numericYear = typeof year === 'number' ? year : Number.parseInt(String(year), 10);
    if (!Number.isInteger(numericYear) || numericYear < 1000 || numericYear > 3000) {
        return undefined;
    }
    return new Date(Date.UTC(numericYear, 0, 1));
}
/**
 * Maps an extracted movie onto the MongoDB `Movie` schema.
 *
 * Only the fields that are present and valid in the payload are emitted, so
 * the result can safely be merged into an existing document with `$set`.
 *
 * @param extracted - Movie extracted from the TXT file.
 * @returns The mapped movie, ready to be written to MongoDB.
 */
function mapExtractedMovie(extracted) {
    const mapped = {};
    const name = toTrimmedString(extracted.name);
    if (name) {
        mapped.name = name.substring(0, MAX_TEXT_LENGTH);
    }
    const originName = toTrimmedString(extracted.originName);
    if (originName) {
        mapped.originName = originName.substring(0, MAX_TEXT_LENGTH);
    }
    const content = toTrimmedString(extracted.content);
    if (content) {
        mapped.content = content;
    }
    const sourceId = toTrimmedString(extracted.id);
    if (sourceId) {
        mapped.sourceId = sourceId.substring(0, 100);
    }
    const slug = toTrimmedString(extracted.slug);
    if (slug) {
        mapped.slug = slug.toLowerCase().substring(0, MAX_TEXT_LENGTH);
    }
    const releaseDate = mapReleaseDate(extracted.year);
    if (releaseDate) {
        mapped.releaseDate = releaseDate;
    }
    const status = toTrimmedString(extracted.status);
    if (status) {
        mapped.status = status.substring(0, 100);
    }
    const time = toTrimmedString(extracted.time);
    if (time) {
        mapped.time = time.substring(0, 100);
    }
    const episodeCurrent = toNumericString(extracted.episodeCurrent);
    if (episodeCurrent) {
        mapped.episodeCurrent = episodeCurrent.substring(0, 100);
    }
    const episodeTotal = toNumericString(extracted.episodeTotal);
    if (episodeTotal) {
        mapped.episodeTotal = episodeTotal.substring(0, 100);
    }
    // The language of the release is the list of the languages reported by the
    // source, e.g. `Vietsub, Song Ngữ`.
    const languages = toNamedList(extracted.languages);
    if (languages.length > 0) {
        mapped.lang = languages
            .map((entry) => entry.name)
            .join(', ')
            .substring(0, 50);
    }
    const thumbUrl = toTrimmedString(extracted.thumbUrl);
    if (thumbUrl) {
        mapped.thumbUrl = thumbUrl.substring(0, 500);
    }
    const posterUrl = toTrimmedString(extracted.posterUrl);
    if (posterUrl) {
        mapped.posterUrl = posterUrl.substring(0, 500);
    }
    const notify = toTrimmedString(extracted.notify);
    if (notify) {
        mapped.notify = notify.substring(0, 255);
    }
    const showtimes = toTrimmedString(extracted.showtimes);
    if (showtimes) {
        mapped.showtimes = showtimes.substring(0, 255);
    }
    const trailer = mapTrailer({ url: extracted.trailerUrl });
    if (trailer) {
        mapped.trailer = trailer;
    }
    // The `Movie` schema stores the numeric TMDB identifier in `tmdb.id`.
    if (extracted.tmdb) {
        const tmdbId = toTrimmedString(extracted.tmdb.tmdbId) ?? toTrimmedString(extracted.tmdb.id);
        const tmdbType = toTrimmedString(extracted.tmdb.type);
        if (tmdbId || tmdbType) {
            const mappedTmdb = {};
            if (tmdbId) {
                mappedTmdb.id = tmdbId;
            }
            if (tmdbType) {
                mappedTmdb.type = tmdbType;
            }
            if (Number.isInteger(extracted.tmdb.season)) {
                mappedTmdb.season = extracted.tmdb.season;
            }
            mapped.tmdb = mappedTmdb;
        }
    }
    if (extracted.actors && extracted.actors.length > 0) {
        mapped.actor = extracted.actors
            .map((actor) => toTrimmedString(actor))
            .filter((actor) => Boolean(actor))
            .map((actor) => actor.substring(0, 255));
    }
    if (extracted.directors && extracted.directors.length > 0) {
        mapped.director = extracted.directors
            .map((director) => toTrimmedString(director))
            .filter((director) => Boolean(director))
            .map((director) => director.substring(0, 255));
    }
    const categories = toNamedList(extracted.categories);
    if (categories.length > 0) {
        mapped.categories = categories;
    }
    const countries = toNamedList(extracted.countries);
    if (countries.length > 0) {
        mapped.countries = countries;
    }
    const episodes = toEpisodeServers(extracted.sources);
    if (episodes.length > 0) {
        mapped.episodes = episodes;
    }
    return mapped;
}
/**
 * Maps a raw payload onto the MongoDB `Movie` schema.
 *
 * Only the fields that are present and valid in the payload are emitted, so
 * the result can safely be merged into an existing document with `$set`.
 *
 * @param raw - Raw payload extracted from the TXT file.
 * @returns The mapped movie, ready to be written to MongoDB.
 */
function mapMovie(raw) {
    const info = raw.info ?? {};
    const mapped = {};
    const name = toTrimmedString(raw.name);
    if (name) {
        mapped.name = name.substring(0, MAX_TEXT_LENGTH);
    }
    const originName = toTrimmedString(raw.originName);
    if (originName) {
        mapped.originName = originName.substring(0, MAX_TEXT_LENGTH);
    }
    const content = toTrimmedString(raw.content);
    if (content) {
        mapped.content = content;
    }
    const sourceId = toTrimmedString(raw.id);
    if (sourceId) {
        mapped.sourceId = sourceId.substring(0, 100);
    }
    const slug = toTrimmedString(raw.slug);
    if (slug) {
        mapped.slug = slug.toLowerCase().substring(0, MAX_TEXT_LENGTH);
    }
    const releaseDate = mapReleaseDate(info.year);
    if (releaseDate) {
        mapped.releaseDate = releaseDate;
    }
    const status = toTrimmedString(info.status);
    if (status) {
        mapped.status = status.substring(0, 100);
    }
    const time = toTrimmedString(info.time);
    if (time) {
        mapped.time = time.substring(0, 100);
    }
    const episodeCurrent = toNumericString(info.episodeCurrent);
    if (episodeCurrent) {
        mapped.episodeCurrent = episodeCurrent.substring(0, 100);
    }
    const episodeTotal = toNumericString(info.episodeTotal);
    if (episodeTotal) {
        mapped.episodeTotal = episodeTotal.substring(0, 100);
    }
    const lang = toTrimmedString(info.languages);
    if (lang) {
        mapped.lang = lang.substring(0, 50);
    }
    const thumbUrl = toTrimmedString(info.thumbUrl);
    if (thumbUrl) {
        mapped.thumbUrl = thumbUrl.substring(0, 500);
    }
    const posterUrl = toTrimmedString(info.posterUrl);
    if (posterUrl) {
        mapped.posterUrl = posterUrl.substring(0, 500);
    }
    const trailer = mapTrailer(raw.trailer, info);
    if (trailer) {
        mapped.trailer = trailer;
    }
    const tmdb = mapTmdb(info.tmdb);
    if (tmdb) {
        mapped.tmdb = tmdb;
    }
    const actors = Array.isArray(raw.actors)
        ? raw.actors
            .map((actor) => toTrimmedString(typeof actor === 'string' ? actor : actor?.name))
            .filter((value) => Boolean(value))
        : [];
    if (actors.length > 0) {
        mapped.actor = actors.map((value) => value.substring(0, 255));
    }
    const directors = toNamedStringList(info.directors);
    if (directors.length > 0) {
        mapped.director = directors.map((value) => value.substring(0, 255));
    }
    const categories = toNamedList(info.categories);
    if (categories.length > 0) {
        mapped.categories = categories;
    }
    const countries = toNamedList(info.countries);
    if (countries.length > 0) {
        mapped.countries = countries;
    }
    const episodes = mapEpisodes(raw.sources);
    if (episodes.length > 0) {
        mapped.episodes = episodes;
    }
    return mapped;
}
/**
 * Converts the mapped movie into a partial MongoDB update document.
 *
 * The `releaseDate` is already carried by the mapped movie (it is derived from
 * the year of the payload), so the document can be built without the raw
 * payload. This lets the importer write a movie extracted from a raw TXT file
 * as well as a movie parsed from a plain JSON document.
 *
 * @param mapped - Mapped movie.
 * @param raw - Optional raw payload, kept for backward compatibility.
 * @returns The document that can be passed to `$set`.
 */
function toMovieDocument(mapped, raw) {
    const document = {};
    for (const [key, value] of Object.entries(mapped)) {
        if (value === undefined) {
            continue;
        }
        // The `Movie` schema does not embed the categories and the countries:
        // they are normalized into their own collections (see `syncRelations`).
        if (key === 'categories' || key === 'countries') {
            continue;
        }
        document[key] = value;
    }
    const releaseDate = mapped.releaseDate ?? mapReleaseDate(raw?.info?.year);
    if (releaseDate) {
        document['releaseDate'] = releaseDate;
    }
    if (document['trailer']) {
        const trailer = document['trailer'];
        const trailerDocument = {};
        if (trailer.url)
            trailerDocument.url = trailer.url;
        if (trailer.key)
            trailerDocument.key = trailer.key;
        if (trailer.name)
            trailerDocument.name = trailer.name;
        if (trailer.site)
            trailerDocument.site = trailer.site;
        if (trailer.type)
            trailerDocument.type = trailer.type;
        if (trailer.official !== undefined)
            trailerDocument.official = trailer.official;
        if (trailer.publishedAt)
            trailerDocument.publishedAt = trailer.publishedAt;
        document['trailer'] = trailerDocument;
    }
    return document;
}
//# sourceMappingURL=movieMapper.service.js.map