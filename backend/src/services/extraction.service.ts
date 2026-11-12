import { SourceFormat } from '../types/extraction.types';
import type {
  ExtractedEpisode,
  ExtractedLanguage,
  ExtractedMovieData,
  ExtractedNamedEntity,
  ExtractedSource,
  ExtractionResult,
} from '../types/extraction.types';
import { findObjectEnd, findObjectsByKey, isPlainObject, parseJsonSlice } from '../utils/jsonScanner';
import { recoverDeep } from '../utils/encodingRecovery';

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
 *   - `view` would map to `viewCount`, which is a cached aggregate protected
 *     by the importer,
 *   - `thumbUrlNguonc`, `posterUrlNguonc`, `logoNameUrl`, `logoNameId`,
 *     `previewUrl` and `previewId` have no counterpart at all.
 */
const MAPPED_MOVIE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'slug',
  'originName',
  'content',
  'type',
  'typeList',
  'typeListId',
  'status',
  'year',
  'thumbUrl',
  'posterUrl',
  'thumbUrlNguonc',
  'posterUrlNguonc',
  'time',
  'episodeCurrent',
  'episodeTotal',
  'quality',
  'isChieuRap',
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
 * Crawling sources known by the `Movie` schema, indexed by the key reported
 * in the `serverKey` field of the sources of a movie.
 *
 * The `source` field of the `Movie` schema is not part of the TXT payload: it
 * is deduced from the servers the movie is streamed on.
 *
 * Only the sites the crawler actually crawls are listed here. The other
 * servers of the payload (`onflix`, `vicdn`, `vsphim`) are alternative CDNs
 * that mirror the movies of the crawled sites: they never identify the
 * crawling source.
 */
const KNOWN_SOURCE_KEYS: ReadonlySet<string> = new Set([
  'ophim',
  'nguonc',
  'kkphim',
]);

/**
 * Order used to pick the source of a movie when several servers are known.
 *
 * The production documents are all crawled from `nguonc`: the `nguonc` server
 * is therefore the first candidate. The `kkphim` and `ophim` servers are only
 * used when the payload carries no `nguonc` server at all.
 */
const SOURCE_KEY_PRIORITY: readonly string[] = ['nguonc', 'kkphim', 'ophim'];

/**
 * Placeholder values used by the source when a field is not filled in yet.
 */
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
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
export function detectSourceFormat(content: string): SourceFormat {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return SourceFormat.UNKNOWN;
  }

  const trimmed = content.trim();

  // A React Flight payload is a list of rows prefixed by an hexadecimal
  // reference, e.g. `25:["$","div",null,{...}]`.
  if (/^[0-9a-f]+:/im.test(trimmed) && trimmed.includes('"$"')) {
    return SourceFormat.REACT_FLIGHT;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return SourceFormat.JSON_DOCUMENT;
  }

  if (/^\s*<(!doctype|html)/i.test(trimmed)) {
    return SourceFormat.HTML;
  }

  // A JSON document embedded in a larger text: the payload starts with a row
  // reference or is surrounded by some text.
  if (trimmed.includes('{') && trimmed.includes('"')) {
    return SourceFormat.EMBEDDED_JSON;
  }

  return SourceFormat.UNKNOWN;
}

/**
 * Checks whether a value is a usable, non placeholder string.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a usable string.
 */
function isUsableString(value: unknown): value is string {
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
function toTrimmedString(value: unknown): string | undefined {
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
export function splitNameList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (isPlainObject(entry)) {
          return toTrimmedString(entry['name']);
        }

        return toTrimmedString(entry);
      })
      .filter((entry): entry is string => Boolean(entry));
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
function toNamedEntities(value: unknown): ExtractedNamedEntity[] {
  if (!Array.isArray(value)) {
    const single = toTrimmedString(value);

    return single ? [{ name: single }] : [];
  }

  const result: ExtractedNamedEntity[] = [];

  for (const entry of value) {
    if (isPlainObject(entry)) {
      const name = toTrimmedString(entry['name']);

      if (!name) {
        continue;
      }

      const entity: ExtractedNamedEntity = { name };
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
function toEpisodes(value: unknown): ExtractedEpisode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const episodes: ExtractedEpisode[] = [];

  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const episode: ExtractedEpisode = {};

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
function toLanguages(value: unknown): ExtractedLanguage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const languages: ExtractedLanguage[] = [];

  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const language: ExtractedLanguage = { episodes: [] };

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
function toSources(value: unknown): ExtractedSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sources: ExtractedSource[] = [];

  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const source: ExtractedSource = { languages: [] };

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
function toTmdb(value: unknown): ExtractedMovieData['tmdb'] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const tmdb: NonNullable<ExtractedMovieData['tmdb']> = {};

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
export function normalizeExtractedMovie(raw: Record<string, unknown>): ExtractedMovieData {
  const data: ExtractedMovieData = { sources: [], unmappedFields: [] };

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

  const typeList = toNamedEntities(raw['typeList']);
  if (typeList.length > 0) {
    data.typeList = typeList;
  }

  const typeListId = toTrimmedString(raw['typeListId']);
  if (typeListId) {
    data.typeListId = typeListId;
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

  // The `nguonc` payloads carry a second set of images, published by `nguonc`
  // itself. The crawler keeps them in `originalThumbUrl` / `originalPosterUrl`.
  const thumbUrlNguonc = toTrimmedString(raw['thumbUrlNguonc']);
  if (thumbUrlNguonc) {
    data.thumbUrlNguonc = thumbUrlNguonc;
  }

  const posterUrlNguonc = toTrimmedString(raw['posterUrlNguonc']);
  if (posterUrlNguonc) {
    data.posterUrlNguonc = posterUrlNguonc;
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

  const sourceKey = deduceSourceKey(data.sources);
  if (sourceKey) {
    data.sourceKey = sourceKey;
  }

  for (const key of Object.keys(raw)) {
    if (!MAPPED_MOVIE_KEYS.has(key)) {
      data.unmappedFields.push(key);
    }
  }

  return data;
}

/**
 * Deduces the crawling source of a movie from the servers it is streamed on.
 *
 * The `source` field of the `Movie` schema is not part of the TXT payload. It
 * is deduced from the `serverKey` of the servers, which identifies the site
 * the data comes from (`kkphim`, `nguonc`, ...).
 *
 * Only the sources known by the crawler are returned: the alternative CDNs
 * (`onflix`, `vicdn`, `vsphim`) are not crawling sources.
 *
 * @param sources - Extracted servers.
 * @returns The deduced source key or `undefined` when it cannot be determined.
 */
export function deduceSourceKey(sources: ExtractedSource[]): string | undefined {
  const keys = new Set<string>();

  for (const source of sources) {
    const key = source.serverKey?.trim().toLowerCase();

    if (key && KNOWN_SOURCE_KEYS.has(key)) {
      keys.add(key);
    }
  }

  if (keys.size === 0) {
    return undefined;
  }

  for (const candidate of SOURCE_KEY_PRIORITY) {
    if (keys.has(candidate)) {
      return candidate;
    }
  }

  return [...keys][0];
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
function enrichWithStandaloneTmdb(
  content: string,
  movie: ExtractedMovieData,
): ExtractedMovieData {
  const ranges = findObjectsByKey(content, 'tmdb');

  for (const range of ranges) {
    const parsed = parseJsonSlice(content.slice(range.start, range.end));

    if (!isPlainObject(parsed)) {
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
          if (!isPlainObject(entry)) {
            return undefined;
          }

          const name = toTrimmedString(entry['name']);

          if (!name) {
            return undefined;
          }

          const member: { name: string; character?: string } = { name };
          const character = toTrimmedString(entry['character']);

          if (character) {
            member.character = character;
          }

          return member;
        })
        .filter((entry): entry is { name: string; character?: string } => Boolean(entry));

      if (cast.length > 0) {
        movie.cast = cast;
      }
    }

    if (Array.isArray(parsed['backdrops'])) {
      const backdrops = parsed['backdrops']
        .map((entry) => {
          if (!isPlainObject(entry)) {
            return undefined;
          }

          return toTrimmedString(entry['file_path']);
        })
        .filter((entry): entry is string => Boolean(entry));

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
export function extractMovieDataCandidates(content: string): ExtractedMovieData[] {
  const ranges = findObjectsByKey(content, MOVIE_DATA_KEY);
  const candidates: ExtractedMovieData[] = [];

  for (const range of ranges) {
    const parsed = parseJsonSlice(content.slice(range.start, range.end));

    if (!isPlainObject(parsed)) {
      continue;
    }

    candidates.push(normalizeExtractedMovie(recoverDeep(parsed)));
  }

  return candidates;
}

/**
 * Resolves the format groups of a movie from its `typeListId`.
 *
 * Some payloads only carry the identifier of the format (`typeListId`) and
 * leave the list itself empty (`typeList: null`). The format group is then
 * looked up in the other objects of the payload, which carry the `id`, the
 * `name` and the `slug` of every format.
 *
 * @param content - Raw text content of the file.
 * @param movie - The movie extracted from the `movieData` object.
 * @returns The enriched movie.
 */
function resolveFormatGroups(
  content: string,
  movie: ExtractedMovieData,
): ExtractedMovieData {
  if (movie.typeList && movie.typeList.length > 0) {
    return movie;
  }

  const typeListId = (movie as ExtractedMovieData & { typeListId?: string }).typeListId;

  if (!typeListId) {
    return movie;
  }

  for (const range of findObjectsByKey(content, 'typeList')) {
    const parsed = parseJsonSlice(content.slice(range.start, range.end));

    if (!isPlainObject(parsed)) {
      continue;
    }

    const recovered = recoverDeep(parsed) as Record<string, unknown>;
    const id = toTrimmedString(recovered['id']);

    if (!id || id !== typeListId) {
      continue;
    }

    const name = toTrimmedString(recovered['name']);

    if (!name) {
      continue;
    }

    const group: ExtractedNamedEntity = { name };
    const slug = toTrimmedString(recovered['slug']);

    if (slug) {
      group.slug = slug;
    }

    movie.typeList = [group];
    break;
  }

  return movie;
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
export function extractMovieData(content: string): ExtractionResult {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return {
      success: false,
      format: SourceFormat.UNKNOWN,
      candidates: [],
      message: 'The file is empty',
    };
  }

  const format = detectSourceFormat(content);

  // A plain JSON document is handled by the legacy parser: the payload is the
  // movie itself.
  if (format === SourceFormat.JSON_DOCUMENT) {
    return {
      success: false,
      format,
      candidates: [],
      message:
        'The file contains a plain JSON document. It is handled by the standard JSON pipeline.',
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
  resolveFormatGroups(content, movie);

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
function scoreCandidate(candidate: ExtractedMovieData): number {
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
export function countExtractedEpisodes(movie: ExtractedMovieData): {
  servers: number;
  episodes: number;
} {
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
export function findFirstJsonObject(content: string): { start: number; end: number } | null {
  const index = content.indexOf('{');

  if (index === -1) {
    return null;
  }

  return findObjectEnd(content, index);
}
