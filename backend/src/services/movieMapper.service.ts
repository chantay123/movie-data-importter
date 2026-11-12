import type {
  ExtractedEpisode,
  ExtractedLanguage,
  ExtractedMovieData,
  ExtractedNamedEntity,
  ExtractedSource,
} from '../types/extraction.types';
import type {
  MappedMovie,
  MappedTmdb,
  MappedTrailer,
  EpisodeServer,
  RawMovieJson,
  RawMovieInfo,
} from '../types/movieImport.types';
import { buildSearchKey, stripDiacritics } from '../utils/normalizeText';
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
 * Movie types accepted by the `Movie` schema.
 *
 * The schema uses an enum, therefore an unknown value would be rejected by
 * mongoose: every value that is not part of the enum falls back to `series`.
 */
const MOVIE_TYPES: ReadonlySet<string> = new Set([
  'series',
  'single',
  'tvshows',
  'hoathinh',
]);

/**
 * Availability statuses accepted by the `Movie` schema.
 */
const AVAILABILITY_STATUSES: ReadonlySet<string> = new Set([
  'upcoming',
  'released',
  'ended',
  'unavailable',
]);

/**
 * Formats reported by the sources, indexed by the `typeList` name of the movie.
 *
 * The crawler stores the format of a movie in the `Format` master data, and
 * the `Movie` document keeps the equivalent `type` enum value.
 */
const FORMAT_TYPE_MAP: ReadonlyMap<string, string> = new Map([
  ['phim bo', 'series'],
  ['phim le', 'single'],
  ['tv shows', 'tvshows'],
  ['tv show', 'tvshows'],
  ['hoat hinh', 'hoathinh'],
  ['anime', 'hoathinh'],
]);

/**
 * Tags removed from the plot summary before it is written to MongoDB.
 *
 * The existing documents store a plain text summary: the HTML wrapper of the
 * source payload is stripped so that the frontend can render the summary
 * without interpreting any markup.
 */
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/gi;

/**
 * Base URL of the TMDB image CDN.
 */
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/original';

/**
 * Turns a TMDB image path into an absolute URL.
 *
 * The TMDB payload reports the backdrop as a relative path, e.g.
 * `/rCFZ9cQQVSa9sAvco2Czcct6aKB.jpg`, which cannot be loaded by the frontend.
 *
 * @param path - Path or absolute URL reported by TMDB.
 * @returns An absolute URL.
 */
export function toAbsoluteTmdbImage(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${TMDB_IMAGE_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Removes the HTML markup of a text.
 *
 * @param value - Text possibly containing HTML.
 * @returns The text without any markup.
 */
export function stripHtml(value: string): string {
  return value
    .replace(HTML_TAG_PATTERN, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Checks that a value is a non empty string.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a string with at least one non space character.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Converts an arbitrary value into a trimmed string, or `undefined` when unusable.
 *
 * @param value - Value to convert.
 * @returns The trimmed string or `undefined`.
 */
function toTrimmedString(value: unknown): string | undefined {
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
function toNumericString(value: unknown): string | undefined {
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
function toNamedStringList(values: unknown): string[] {
  if (isNonEmptyString(values)) {
    return [values.trim()];
  }

  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => toTrimmedString(value))
    .filter((value): value is string => Boolean(value));
}

/**
 * Extracts the list of names carried by the `categories` / `countries` fields.
 *
 * @param values - Raw list, either plain strings or objects with a name.
 * @returns The list of `{ name, slug }` pairs.
 */
function toNamedList(values: unknown): Array<{ name: string; slug: string }> {
  if (!Array.isArray(values)) {
    return [];
  }

  const result: Array<{ name: string; slug: string }> = [];

  for (const value of values) {
    if (isNonEmptyString(value)) {
      result.push({ name: value.trim(), slug: '' });
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      const entry = value as { name?: unknown; slug?: unknown };
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
export function extractYoutubeKey(url: string): string | undefined {
  const patterns: RegExp[] = [
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
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Builds the name of a server group from its name and its language.
 *
 * The `Movie` schema stores one group per server, therefore a server that
 * exposes several languages is split into one group per language.
 *
 * The name of the group is the name of the server as it appears in the source
 * payload (e.g. `KKPhim`, `NguonC`). The language is only appended when the
 * server exposes several languages, because a single language group does not
 * need it:
 *   - `KKPhim` with a single language -> `KKPhim`
 *   - `NguonC` with `Vietsub` and `Thuyết minh` -> `NguonC - Vietsub` and
 *     `NguonC - Thuyết minh`
 *
 * When the language name is already part of the server name (e.g. `Vietsub #1`),
 * the name is kept as it is.
 *
 * @param serverName - Name of the server.
 * @param languageName - Name of the language.
 * @returns The name of the group.
 */
export function buildServerGroupName(
  serverName: string,
  languageName: string | undefined,
): string {
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
 * Normalizes the name of a format group so it matches the master data.
 *
 * The `Format` master data stores the format groups of the crawler with the
 * first letter capitalized and the rest in lowercase, e.g. `Phim bộ`,
 * `Phim lẻ`, `TV shows`.
 *
 * @param name - Name of the format group.
 * @returns The normalized name.
 */
function normalizeFormatName(name: string): string {
  const collapsed = collapseWhitespace(name);

  if (collapsed.toLowerCase() === 'tv shows') {
    return 'TV shows';
  }

  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1).toLowerCase();
}

/**
 * Maps the `typeList` of a movie onto the name of the `Format` master data.
 *
 * @param typeList - Format groups reported by the source.
 * @returns The name of the format group or `undefined` when none is known.
 */
export function mapFormatName(typeList: ExtractedNamedEntity[] | undefined): string | undefined {
  for (const entry of typeList ?? []) {
    const raw = entry.name?.trim();

    if (!raw) {
      continue;
    }

    // Only the known format groups are stored: a payload may carry other
    // groups (e.g. `TV Shows` for an anime) that have no master data yet.
    const key = stripDiacritics(raw.toLowerCase()).replace(/\s+/g, ' ');

    if (FORMAT_TYPE_MAP.has(key)) {
      return normalizeFormatName(raw);
    }
  }

  return undefined;
}

/**
 * Maps the `typeList` of a movie onto the `type` enum of the `Movie` schema.
 *
 * The sources report the format of a movie as a list of groups, e.g.
 * `Phim Bộ`, `Phim Lẻ`, `TV Shows`. The first group that can be mapped wins.
 *
 * @param typeList - Format groups reported by the source.
 * @returns The `type` value or `undefined` when nothing could be mapped.
 */
export function mapMovieType(typeList: ExtractedNamedEntity[] | undefined): string | undefined {
  for (const entry of typeList ?? []) {
    // The format names carry Vietnamese diacritics (`Phim Bộ`), therefore they
    // are compared without their diacritics.
    const key = stripDiacritics(entry.name.trim().toLowerCase()).replace(/\s+/g, ' ');
    const mapped = FORMAT_TYPE_MAP.get(key);

    if (mapped) {
      return mapped;
    }
  }

  return undefined;
}

/**
 * Derives the availability status of a movie from its release date.
 *
 * A movie whose release date is in the future is `upcoming`, otherwise it is
 * `released`. The `Movie` schema uses an enum, therefore only the four
 * documented values are produced.
 *
 * @param releaseDate - Release date of the movie.
 * @returns The availability status.
 */
export function mapAvailabilityStatus(releaseDate: Date | undefined): string {
  if (!releaseDate) {
    return 'released';
  }

  const status = releaseDate.getTime() > Date.now() ? 'upcoming' : 'released';

  return AVAILABILITY_STATUSES.has(status) ? status : 'released';
}

/**
 * Builds the `episodeCurrent` label of a movie.
 *
 * The `Movie` schema stores the label of the current episode. The production
 * documents use the label reported by the source (`Tập 10`, `Hoàn tất (10/10)`,
 * `FULL`, ...), so the label is only normalized when the source reports a
 * completed movie without any label.
 *
 * @param episodeCurrent - Raw current episode label.
 * @param episodeTotal - Total number of episodes.
 * @param status - Publication status of the movie.
 * @returns The label of the current episode.
 */
export function mapEpisodeCurrent(
  episodeCurrent: string | undefined,
  episodeTotal: string | undefined,
  status: string | undefined,
): string | undefined {
  const raw = episodeCurrent?.trim();
  const total = episodeTotal?.trim();
  const isCompleted = status?.trim().toLowerCase() === 'completed';

  // The source already reports a label: it is kept as it is, so that the
  // importer never rewrites a label the crawler already stored.
  if (raw) {
    return raw;
  }

  // A completed movie without any label follows the `Hoàn tất (x/y)`
  // convention of the production documents.
  if (isCompleted && total) {
    return `Hoàn tất (${total}/${total})`;
  }

  return undefined;
}

/**
 * Maps the extracted episodes into the MongoDB episode entries.
 *
 * @param episodes - Extracted episodes.
 * @returns The MongoDB episode entries, in their original order.
 */
function toEpisodeEntries(episodes: ExtractedEpisode[]): EpisodeServer['server_data'] {
  const entries: EpisodeServer['server_data'] = [];
  const seen = new Set<string>();

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
 * The name of the group is the name of the language group reported by the
 * source (e.g. `Vietsub #1`, `Thuyết minh #1`), because that is what the
 * production documents store: the `nguonc` source already names its groups
 * after the language they carry. When the source reports a plain language
 * name (e.g. `Vietsub`), the name of the server is used instead, so that the
 * group stays identifiable.
 *
 * @param sources - Extracted servers.
 * @returns The MongoDB episode servers.
 */
export function toEpisodeServers(sources: ExtractedSource[]): EpisodeServer[] {
  const servers: EpisodeServer[] = [];
  const usedNames = new Set<string>();

  for (const source of sources) {
    const serverName = source.serverName ? collapseWhitespace(source.serverName) : '';

    if (!serverName) {
      continue;
    }

    const languages: ExtractedLanguage[] = source.languages;

    // A server without any language group keeps its episodes at the top level.
    if (languages.length === 0) {
      servers.push({ server_name: serverName, server_data: [] });
      continue;
    }

    for (const language of languages) {
      // The language group of the `nguonc` source is already named after the
      // language it carries (`Vietsub #1`). It is used as it is.
      const languageName = language.name ? collapseWhitespace(language.name) : '';
      const groupName = languageName || serverName;

      // Two groups of two different servers can end up with the same name once
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
function mapEpisodes(sources: unknown): EpisodeServer[] {
  if (!Array.isArray(sources)) {
    return [];
  }

  const servers: EpisodeServer[] = [];
  const seenServers = new Set<string>();

  for (const rawServer of sources) {
    if (typeof rawServer !== 'object' || rawServer === null) {
      continue;
    }

    const server = rawServer as { server_name?: unknown; server_data?: unknown };
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
    const episodes: EpisodeServer['server_data'] = [];
    const seenEpisodes = new Set<string>();

    for (const rawEpisode of rawEpisodes) {
      if (typeof rawEpisode !== 'object' || rawEpisode === null) {
        continue;
      }

      const episode = rawEpisode as {
        name?: unknown;
        slug?: unknown;
        filename?: unknown;
        link_embed?: unknown;
        link_m3u8?: unknown;
      };

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
export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
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
export function mapTrailer(raw: RawMovieJson['trailer'], info?: RawMovieInfo): MappedTrailer | undefined {
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

  const trailer: MappedTrailer = {};

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
export function mapTmdb(raw: RawMovieInfo['tmdb']): MappedTmdb | undefined {
  if (!raw) {
    return undefined;
  }

  const id = toTrimmedString(raw.id);
  const type = toTrimmedString(raw.type);

  if (!id && !type) {
    return undefined;
  }

  const tmdb: MappedTmdb = {};

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
export function mapReleaseDate(year: unknown): Date | undefined {
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
export function mapExtractedMovie(extracted: ExtractedMovieData): MappedMovie {
  const mapped: MappedMovie = {};

  const name = toTrimmedString(extracted.name);
  if (name) {
    mapped.name = name.substring(0, MAX_TEXT_LENGTH);
  }

  const originName = toTrimmedString(extracted.originName);
  if (originName) {
    mapped.originName = originName.substring(0, MAX_TEXT_LENGTH);
  }

  // The production documents store a search key next to each title. They are
  // used by the search endpoint of the backend to match a query against a
  // movie without having to strip the diacritics on the fly.
  const nameKey = buildSearchKey(name);
  if (nameKey) {
    mapped.name_normalized = nameKey.substring(0, MAX_TEXT_LENGTH);
  }

  const originNameKey = buildSearchKey(originName);
  if (originNameKey) {
    mapped.originName_normalized = originNameKey.substring(0, MAX_TEXT_LENGTH);
  }

  const content = toTrimmedString(extracted.content);
  if (content) {
    // The existing documents store a plain text summary.
    mapped.content = stripHtml(content);
  }

  const slug = toTrimmedString(extracted.slug);
  if (slug) {
    mapped.slug = slug.toLowerCase().substring(0, MAX_TEXT_LENGTH);
  }

  // The production documents use the slug as the source identifier: the
  // crawler stores `sourceId: crawlerData._id || crawlerData.slug` and the
  // `nguonc` source does not expose an `_id`, so the slug is what ends up in
  // the database.
  const sourceId = toTrimmedString(extracted.slug) ?? toTrimmedString(extracted.id);
  if (sourceId) {
    mapped.sourceId = sourceId.substring(0, 100);
  }

  // The `source` field is not part of the TXT payload: it is deduced from the
  // servers the movie is streamed on.
  const source = toTrimmedString(extracted.sourceKey);
  if (source) {
    mapped.source = source.substring(0, 50);
  }

  const releaseDate = mapReleaseDate(extracted.year);
  if (releaseDate) {
    mapped.releaseDate = releaseDate;
  }

  const status = toTrimmedString(extracted.status);
  if (status) {
    mapped.status = status.substring(0, 100);
  }

  // The `type` enum is deduced from the format groups of the movie, and
  // falls back to the type reported by the source.
  const type =
    mapMovieType(extracted.typeList) ??
    (MOVIE_TYPES.has(extracted.type?.trim().toLowerCase() ?? '')
      ? extracted.type?.trim().toLowerCase()
      : undefined);
  if (type) {
    mapped.type = type;
  }

  mapped.availabilityStatus = mapAvailabilityStatus(releaseDate);

  const time = toTrimmedString(extracted.time);
  if (time) {
    mapped.time = time.substring(0, 100);
  }

  const episodeTotal = toNumericString(extracted.episodeTotal);
  if (episodeTotal) {
    mapped.episodeTotal = episodeTotal.substring(0, 100);
  }

  const episodeCurrent = mapEpisodeCurrent(
    extracted.episodeCurrent,
    episodeTotal,
    status,
  );
  if (episodeCurrent) {
    mapped.episodeCurrent = episodeCurrent.substring(0, 100);
  }

  // The language of the release is the list of the languages reported by the
  // source. The production documents join them with ` + `, e.g.
  // `Vietsub + Thuyết Minh`.
  const languages = toNamedList(extracted.languages);
  if (languages.length > 0) {
    mapped.lang = languages
      .map((entry) => entry.name)
      .join(' + ')
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

  // The `nguonc` payloads carry a second set of images published by `nguonc`
  // itself. The production documents keep them in `originalPosterUrl` /
  // `originalThumbUrl` so that the Cloudinary migration can be rolled back.
  const originalPosterUrl = toTrimmedString(extracted.posterUrlNguonc);
  if (originalPosterUrl) {
    mapped.originalPosterUrl = originalPosterUrl.substring(0, 500);
  }

  const originalThumbUrl = toTrimmedString(extracted.thumbUrlNguonc);
  if (originalThumbUrl) {
    mapped.originalThumbUrl = originalThumbUrl.substring(0, 500);
  }

  const notify = toTrimmedString(extracted.notify);
  if (notify) {
    mapped.notify = notify.substring(0, 255);
  }

  const showtimes = toTrimmedString(extracted.showtimes);
  if (showtimes) {
    mapped.showtimes = showtimes.substring(0, 255);
  }

  // The format of a movie is not stored on the `Movie` document but in the
  // `Format` master data, linked through the `movieformats` junction
  // collection.
  //
  // The production documents use the *format group* of the movie (e.g.
  // `Phim bộ`, `Phim lẻ`, `TV shows`), not the video quality reported by the
  // source (e.g. `FHD`, `HD`). The group is the one that matches the `type`
  // enum of the document.
  const formatName = mapFormatName(extracted.typeList);
  if (formatName) {
    mapped.quality = formatName.substring(0, 100);
  }

  if (Number.isInteger(extracted.year)) {
    mapped.year = extracted.year;
  }

  if (typeof extracted.isChieuRap === 'boolean') {
    mapped.chieurap = extracted.isChieuRap;
  }

  const backdropUrl = toTrimmedString(extracted.backdrops?.[0]);
  if (backdropUrl) {
    // TMDB reports a relative path: it is turned into an absolute URL so
    // that the image can be loaded directly by the frontend.
    mapped.backdropUrl = toAbsoluteTmdbImage(backdropUrl).substring(0, 500);
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
      const mappedTmdb: MappedTmdb = {};

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
      .filter((actor): actor is string => Boolean(actor))
      .map((actor) => actor.substring(0, 255));
  }

  if (extracted.directors && extracted.directors.length > 0) {
    mapped.director = extracted.directors
      .map((director) => toTrimmedString(director))
      .filter((director): director is string => Boolean(director))
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

  // The production documents only carry the episodes of the server the movie
  // was crawled from: the crawler stores the episodes of its own source, not
  // the ones of the alternative CDNs listed in the payload.
  //
  // The `nguonc` server is therefore kept when the payload carries one, and
  // the other servers are used only as a fallback.
  const episodes = toEpisodeServers(pickSourceServers(extracted));
  if (episodes.length > 0) {
    mapped.episodes = episodes;
  }

  return mapped;
}

/**
 * Keeps the servers of the crawling source of the movie.
 *
 * The production documents only carry the episodes of the server the movie was
 * crawled from. The alternative CDNs (`KKPhim`, `OnFlix`, `ViCDN`, `VSPhim`)
 * are only used when the payload carries no server of the source itself.
 *
 * @param extracted - Extracted movie.
 * @returns The servers to store in the document.
 */
export function pickSourceServers(extracted: ExtractedMovieData): ExtractedSource[] {
  const sources = extracted.sources ?? [];

  if (sources.length === 0) {
    return sources;
  }

  const sourceKey = extracted.sourceKey?.trim().toLowerCase();

  if (!sourceKey) {
    return sources;
  }

  const fromSource = sources.filter(
    (source) => source.serverKey?.trim().toLowerCase() === sourceKey,
  );

  return fromSource.length > 0 ? fromSource : sources;
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
export function mapMovie(raw: RawMovieJson): MappedMovie {
  const info = raw.info ?? {};
  const mapped: MappedMovie = {};

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
        .filter((value): value is string => Boolean(value))
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
export function toMovieDocument(
  mapped: MappedMovie,
  raw?: RawMovieJson,
): Record<string, unknown> {
  const document: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(mapped)) {
    if (value === undefined) {
      continue;
    }

    // The `Movie` schema does not embed the categories, the countries, the
    // quality and the year: they are normalized into their own collections
    // (see `syncRelations`).
    if (key === 'categories' || key === 'countries' || key === 'quality' || key === 'year') {
      continue;
    }

    document[key] = value;
  }

  const releaseDate = mapped.releaseDate ?? mapReleaseDate(raw?.info?.year);
  if (releaseDate) {
    document['releaseDate'] = releaseDate;
  }

  if (document['trailer']) {
    const trailer = document['trailer'] as MappedTrailer;
    const trailerDocument: Record<string, unknown> = {};

    if (trailer.url) trailerDocument.url = trailer.url;
    if (trailer.key) trailerDocument.key = trailer.key;
    if (trailer.name) trailerDocument.name = trailer.name;
    if (trailer.site) trailerDocument.site = trailer.site;
    if (trailer.type) trailerDocument.type = trailer.type;
    if (trailer.official !== undefined) trailerDocument.official = trailer.official;
    if (trailer.publishedAt) trailerDocument.publishedAt = trailer.publishedAt;

    document['trailer'] = trailerDocument;
  }

  return document;
}
