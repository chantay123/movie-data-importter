import { FieldStatus, MatchStatus, MergeStrategy } from '../constants/importStatus';
import type {
  EpisodeServer,
  ExistingMovie,
  FieldDiff,
  MappedMovie,
  MovieComparison,
} from '../types/movieImport.types';
import { normalizeText } from '../utils/normalizeText';

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
 *
 * `chieurap` is not part of this list: the `Movie` schema declares it and the
 * source reports it in the `isChieuRap` field, therefore it can safely be
 * written.
 */
export const PROTECTED_FIELDS: ReadonlySet<string> = new Set([
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
  'subDocquyen',
]);

/**
 * Fields that use the union merge strategy instead of a plain replacement.
 */
const ARRAY_MERGE_FIELDS: ReadonlySet<string> = new Set(['actor', 'director']);

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
function isSameManagedObject(
  left: unknown,
  right: unknown,
  managedKeys: ReadonlySet<string>,
): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return left === right;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;

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
const MANAGED_TRAILER_KEYS: ReadonlySet<string> = new Set(['url', 'key', 'name', 'site', 'type']);

/**
 * Fields of the `tmdb` object the importer is allowed to write.
 */
const MANAGED_TMDB_KEYS: ReadonlySet<string> = new Set(['id', 'type', 'season']);

/**
 * Compares two primitive values.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns `true` when both values are equivalent.
 */
function isSameValue(left: unknown, right: unknown): boolean {
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
    const leftKeys = Object.keys(left as Record<string, unknown>).sort();
    const rightKeys = Object.keys(right as Record<string, unknown>).sort();

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        isSameValue(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    );
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
function isSameStringSet(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  const normalize = (values: unknown[]): string[] =>
    values.map((value) => normalizeText(String(value ?? ''))).sort();

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
function isSameEpisodeSet(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  const summarize = (servers: EpisodeServer[]): string[] =>
    servers
      .map(
        (server) =>
          `${server.server_name.toLowerCase()}:${server.server_data
            .map((episode) => episode.slug.toLowerCase())
            .join(',')}`,
      )
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
function compareField(
  field: string,
  currentValue: unknown,
  incomingValue: unknown,
): FieldDiff {
  const isProtected = PROTECTED_FIELDS.has(field);

  if (isProtected) {
    return {
      field,
      currentValue,
      incomingValue,
      status: FieldStatus.CONFLICT,
      isProtected: true,
      message: 'This field is protected and is never written by the importer',
    };
  }

  if (incomingValue === undefined || incomingValue === null) {
    return {
      field,
      currentValue,
      incomingValue,
      status: FieldStatus.MISSING,
      isProtected,
      message: 'The source file does not contain this field, the database value is kept',
    };
  }

  const same =
    field === 'episodes'
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
      status: FieldStatus.UNCHANGED,
      isProtected,
      message: 'The database already contains the same value',
    };
  }

  const mergeStrategy =
    ARRAY_MERGE_FIELDS.has(field) || field === 'episodes'
      ? MergeStrategy.UNION
      : MergeStrategy.REPLACE;

  return {
    field,
    currentValue,
    incomingValue,
    status: FieldStatus.CHANGED,
    mergeStrategy,
    isProtected,
    message:
      mergeStrategy === MergeStrategy.UNION
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
export function diffMovie(mapped: MappedMovie, existing?: ExistingMovie): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  const simpleFields: Array<keyof MappedMovie> = [
    'name',
    'originName',
    'content',
    'slug',
    'sourceId',
    'source',
    'releaseDate',
    'status',
    'type',
    'availabilityStatus',
    'time',
    'episodeCurrent',
    'episodeTotal',
    'lang',
    'thumbUrl',
    'posterUrl',
    'backdropUrl',
    'chieurap',
    'name_normalized',
    'originName_normalized',
    'originalPosterUrl',
    'originalThumbUrl',
    'notify',
    'showtimes',
    'trailer',
    'tmdb',
  ];

  for (const field of simpleFields) {
    const incomingValue = mapped[field];
    const currentValue = existing
      ? (existing as unknown as Record<string, unknown>)[field as string]
      : undefined;

    diffs.push(compareField(field as string, currentValue, incomingValue));
  }

  diffs.push(compareField('actor', existing?.actor, mapped.actor));
  diffs.push(compareField('director', existing?.director, mapped.director));
  diffs.push(compareField('episodes', existing?.episodes, mapped.episodes));

  // The protected fields are always listed so the user can see that the
  // importer deliberately leaves them untouched.
  for (const field of PROTECTED_FIELDS) {
    if (diffs.some((diff) => diff.field === field)) {
      continue;
    }

    diffs.push(
      compareField(
        field,
        existing ? (existing as unknown as Record<string, unknown>)[field] : undefined,
        undefined,
      ),
    );
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
export function buildComparison(
  fileId: string,
  mapped: MappedMovie,
  match: {
    status: string;
    matchedBy?: 'sourceId' | 'tmdb' | 'slug' | 'name' | 'originName';
    movie?: ExistingMovie;
    candidates: ExistingMovie[];
    message?: string;
  },
): MovieComparison {
  const diffs = diffMovie(mapped, match.movie);

  const isNew = match.status === MatchStatus.NEW || !match.movie;

  const updatableFields = diffs
    .filter((diff) => {
      if (diff.isProtected) {
        return false;
      }

      if (isNew) {
        // A brand new document receives every field that carries a usable value.
        return diff.status === FieldStatus.CHANGED || diff.status === FieldStatus.UNCHANGED;
      }

      return diff.status === FieldStatus.CHANGED;
    })
    .map((diff) => diff.field);

  return {
    fileId,
    matchStatus: match.status as MovieComparison['matchStatus'],
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
export function mergeEpisodes(
  existing: EpisodeServer[] | undefined,
  incoming: EpisodeServer[] | undefined,
): { episodes: EpisodeServer[]; added: number; updated: number } {
  const result: EpisodeServer[] = (existing ?? []).map((server) => ({
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
    const existingServer = result.find(
      (server) => server.server_name.toLowerCase() === serverName,
    );

    if (!existingServer) {
      result.push({
        server_name: incomingServer.server_name,
        server_data: incomingServer.server_data.map((episode) => ({ ...episode })),
      });
      added += incomingServer.server_data.length;
      continue;
    }

    for (const incomingEpisode of incomingServer.server_data) {
      const existingEpisode = existingServer.server_data.find(
        (episode) => episode.slug.toLowerCase() === incomingEpisode.slug.toLowerCase(),
      );

      if (!existingEpisode) {
        existingServer.server_data.push({ ...incomingEpisode });
        added += 1;
        continue;
      }

      // The episode already exists: refresh its links but keep its identity.
      let changed = false;
      if (
        incomingEpisode.link_embed &&
        incomingEpisode.link_embed !== existingEpisode.link_embed
      ) {
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
export function mergeStringArray(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  const result = [...(existing ?? [])];
  const seen = new Set(result.map((value) => normalizeText(value)));

  for (const value of incoming ?? []) {
    const key = normalizeText(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}
