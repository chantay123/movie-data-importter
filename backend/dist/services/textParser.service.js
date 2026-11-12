"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJsonPayload = parseJsonPayload;
exports.countReadableFields = countReadableFields;
exports.countEpisodes = countEpisodes;
exports.parseMovieFile = parseMovieFile;
const importStatus_1 = require("../constants/importStatus");
const extraction_types_1 = require("../types/extraction.types");
const extraction_service_1 = require("./extraction.service");
const movieMapper_service_1 = require("./movieMapper.service");
/**
 * Parser responsible for turning the raw content of a `.txt` file into the
 * intermediate JSON structure used by the rest of the pipeline.
 *
 * The TXT files are not always plain JSON documents: they can be React Flight
 * payloads, Next.js Server Component payloads, JSON documents embedded in a
 * larger text or raw HTML pages. The parser therefore:
 *   1. strips a UTF-8 BOM and normalizes the line endings,
 *   2. detects the format of the payload,
 *   3. extracts the `movieData` object with a character scanner,
 *   4. maps it onto the MongoDB `Movie` schema.
 *
 * The whole file is never parsed as a single JSON document.
 */
/**
 * Maximum number of characters read from a single file.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/**
 * Extracts the JSON object contained in a text blob.
 *
 * @param content - Raw text content of the file.
 * @returns The JSON substring or `null` when no object could be located.
 */
function extractJsonBlock(content) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    return content.slice(start, end + 1);
}
/**
 * Parses the raw text of a TXT file into the intermediate JSON structure.
 *
 * @param content - Raw text content of the file.
 * @returns The parsed payload or `null` when the content is not valid JSON.
 */
function parseJsonPayload(content) {
    const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const block = extractJsonBlock(normalized);
    if (!block) {
        return null;
    }
    try {
        const parsed = JSON.parse(block);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * Counts the number of fields that could be read from the payload.
 *
 * @param raw - Parsed payload.
 * @returns The number of readable fields.
 */
function countReadableFields(raw) {
    let count = 0;
    const topLevelKeys = ['id', 'name', 'slug', 'originName', 'content', 'actors', 'info', 'sources', 'trailer'];
    for (const key of topLevelKeys) {
        const value = raw[key];
        if (value !== undefined && value !== null && value !== '') {
            count += 1;
        }
    }
    const info = raw.info;
    if (info && typeof info === 'object') {
        const infoKeys = [
            'directors',
            'year',
            'status',
            'time',
            'episodeCurrent',
            'episodeTotal',
            'quality',
            'view',
            'trailerUrl',
            'thumbUrl',
            'posterUrl',
            'categories',
            'countries',
            'languages',
            'tmdb',
        ];
        for (const key of infoKeys) {
            const value = info[key];
            if (value !== undefined && value !== null && value !== '') {
                count += 1;
            }
        }
    }
    return count;
}
/**
 * Counts the total number of episodes across every server.
 *
 * @param raw - Parsed payload.
 * @returns The number of episodes.
 */
function countEpisodes(raw) {
    if (!Array.isArray(raw.sources)) {
        return 0;
    }
    return raw.sources.reduce((total, server) => {
        if (typeof server !== 'object' || server === null) {
            return total;
        }
        const episodes = Array.isArray(server.server_data) ? server.server_data : [];
        return total + episodes.length;
    }, 0);
}
/**
 * Builds the result of a failed parsing.
 *
 * @param fileName - Name of the file.
 * @param fileSize - Size of the file in bytes.
 * @param message - Explanation of the failure.
 * @param stage - Stage the file stopped at.
 * @returns The failed result.
 */
function buildFailure(fileName, fileSize, message, stage) {
    return {
        fileName,
        fileSize,
        issues: [{ field: 'file', message, severity: 'error' }],
        isValid: false,
        readableFieldCount: 0,
        episodeCount: 0,
        serverCount: 0,
        sourceFormat: extraction_types_1.SourceFormat.UNKNOWN,
        unmappedFields: [],
        status: importStatus_1.ImportStatus.FAILED,
        stage,
    };
}
/**
 * Reads and parses a single TXT file.
 *
 * The function never throws: a failure is reported through the returned
 * result so that one broken file cannot stop the whole batch.
 *
 * @param fileName - Name of the file (used for the report).
 * @param fileSize - Size of the file in bytes.
 * @param content - Raw text content of the file.
 * @returns The parsing result, including the mapped movie when possible.
 */
function parseMovieFile(fileName, fileSize, content) {
    const issues = [];
    if (fileSize > MAX_FILE_SIZE) {
        return buildFailure(fileName, fileSize, `File is larger than the ${MAX_FILE_SIZE} byte limit`, importStatus_1.ProcessingStage.READING);
    }
    const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const extraction = (0, extraction_service_1.extractMovieData)(normalized);
    // A plain JSON document is handled by the standard JSON pipeline: the whole
    // document is the movie.
    if (extraction.format === extraction_types_1.SourceFormat.JSON_DOCUMENT) {
        return parseJsonDocument(fileName, fileSize, normalized);
    }
    if (!extraction.success || !extraction.data) {
        return buildFailure(fileName, fileSize, extraction.message ?? 'The movie could not be extracted from the file', importStatus_1.ProcessingStage.PARSING);
    }
    const mapped = (0, movieMapper_service_1.mapExtractedMovie)(extraction.data);
    const { servers, episodes } = (0, extraction_service_1.countExtractedEpisodes)(extraction.data);
    const detectedName = extraction.data.name ?? extraction.data.slug;
    if (!mapped.name) {
        issues.push({
            field: 'name',
            message: 'The movie has no name, it cannot be imported',
            severity: 'error',
        });
    }
    if (!mapped.slug) {
        issues.push({
            field: 'slug',
            message: 'The movie has no slug, one will be generated from its name',
            severity: 'warning',
        });
    }
    if (!mapped.sourceId) {
        issues.push({
            field: 'sourceId',
            message: 'The movie has no source identifier, it will be matched by its slug only',
            severity: 'warning',
        });
    }
    if (episodes === 0) {
        issues.push({
            field: 'episodes',
            message: 'The movie has no episode, the existing episodes will be kept',
            severity: 'warning',
        });
    }
    // The number of servers and of episodes extracted from the file must match
    // the number of groups produced by the mapper: a mismatch means the data
    // was lost during the conversion and the file must not be imported blindly.
    const mappedServerCount = mapped.episodes?.length ?? 0;
    const mappedEpisodeCount = mapped.episodes?.reduce((total, server) => total + server.server_data.length, 0) ?? 0;
    if (mappedEpisodeCount !== episodes) {
        issues.push({
            field: 'episodes',
            message: `The conversion lost episodes: ${episodes} were extracted but ${mappedEpisodeCount} were converted`,
            severity: 'error',
        });
    }
    if (mappedServerCount < servers) {
        issues.push({
            field: 'sources',
            message: `The conversion lost servers: ${servers} were extracted but ${mappedServerCount} were converted`,
            severity: 'error',
        });
    }
    const hasError = issues.some((issue) => issue.severity === 'error');
    return {
        fileName,
        fileSize,
        extracted: extraction.data,
        mapped,
        issues,
        isValid: !hasError,
        readableFieldCount: countExtractedFields(extraction),
        episodeCount: mappedEpisodeCount,
        serverCount: mappedServerCount,
        sourceFormat: extraction.format,
        unmappedFields: extraction.data.unmappedFields,
        detectedName,
        status: hasError ? importStatus_1.ImportStatus.FAILED : importStatus_1.ImportStatus.SUCCESS,
        stage: importStatus_1.ProcessingStage.VALIDATING,
    };
}
/**
 * Parses a file that contains a plain JSON document.
 *
 * @param fileName - Name of the file.
 * @param fileSize - Size of the file in bytes.
 * @param content - Normalized content of the file.
 * @returns The parsing result.
 */
function parseJsonDocument(fileName, fileSize, content) {
    const issues = [];
    const raw = parseJsonPayload(content);
    if (!raw) {
        return buildFailure(fileName, fileSize, 'The file does not contain a valid JSON payload', importStatus_1.ProcessingStage.PARSING);
    }
    const mapped = (0, movieMapper_service_1.mapMovie)(raw);
    const episodeCount = countEpisodes(raw);
    const detectedName = typeof raw.name === 'string' && raw.name.trim().length > 0
        ? raw.name.trim()
        : typeof raw.slug === 'string' && raw.slug.trim().length > 0
            ? raw.slug.trim()
            : undefined;
    if (!mapped.name) {
        issues.push({
            field: 'name',
            message: 'The movie has no name, it cannot be imported',
            severity: 'error',
        });
    }
    if (!mapped.slug) {
        issues.push({
            field: 'slug',
            message: 'The movie has no slug, one will be generated from its name',
            severity: 'warning',
        });
    }
    if (episodeCount === 0) {
        issues.push({
            field: 'episodes',
            message: 'The movie has no episode, the existing episodes will be kept',
            severity: 'warning',
        });
    }
    const hasError = issues.some((issue) => issue.severity === 'error');
    return {
        fileName,
        fileSize,
        raw,
        mapped,
        issues,
        isValid: !hasError,
        readableFieldCount: countReadableFields(raw),
        episodeCount,
        serverCount: raw.sources?.length ?? 0,
        sourceFormat: extraction_types_1.SourceFormat.JSON_DOCUMENT,
        unmappedFields: [],
        detectedName,
        status: hasError ? importStatus_1.ImportStatus.FAILED : importStatus_1.ImportStatus.SUCCESS,
        stage: importStatus_1.ProcessingStage.VALIDATING,
    };
}
/**
 * Counts the number of fields that were read from an extracted movie.
 *
 * @param extraction - Result of the extraction.
 * @returns The number of readable fields.
 */
function countExtractedFields(extraction) {
    const data = extraction.data;
    if (!data) {
        return 0;
    }
    const fields = [
        data.id,
        data.name,
        data.slug,
        data.originName,
        data.content,
        data.type,
        data.status,
        data.year,
        data.thumbUrl,
        data.posterUrl,
        data.time,
        data.episodeCurrent,
        data.episodeTotal,
        data.quality,
        data.view,
        data.trailerUrl,
        data.actors,
        data.directors,
        data.categories,
        data.countries,
        data.languages,
        data.tmdb,
        data.sources,
    ];
    return fields.filter((field) => field !== undefined && field !== null && field !== '').length;
}
//# sourceMappingURL=textParser.service.js.map