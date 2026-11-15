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
 * Fields that are derived from another field and therefore never decide on
 * their own whether a movie changed.
 *
 * The search keys are recomputed from the title: a document that does not
 * store them yet does not differ from the incoming payload in a meaningful
 * way, and reporting a change for them would prevent the importer from
 * recognizing an already up-to-date movie.
 */
const DERIVED_FIELDS: ReadonlySet<string> = new Set([
  'name_normalized',
  'originName_normalized',
]);

/**
 * Backup field of an image field, used when the image was migrated.
 */
const IMAGE_BACKUP_FIELDS: ReadonlyMap<string, string> = new Map([
  ['thumbUrl', 'originalThumbUrl'],
  ['posterUrl', 'originalPosterUrl'],
]);

/**
 * Checks whether a URL points to an image hosted on Cloudinary.
 *
 * The images of the production documents were migrated to Cloudinary by the
 * dedicated migration tool: the document then holds a `res.cloudinary.com`
 * URL while the source file still carries the URL of the original image.
 *
 * The importer never uploads anything, therefore it must never overwrite a
 * migrated URL with the raw URL of the source: the migrated image would be
 * lost.
 *
 * @param value - Value to test.
 * @returns `true` when the value is a Cloudinary URL.
 */
function isCloudinaryUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  try {
    return new URL(value).hostname.toLowerCase().endsWith('res.cloudinary.com');
  } catch {
    return false;
  }
}

/**
 * Normalizes the name of an episode so two spellings of the same episode
 * compare equal.
 *
 * The crawler stores the bare episode number (`1`) while the sources report a
 * labelled episode (`Tập 1`, `Tap 1`, `Episode 1`): the two describe the same
 * episode and must not be reported as a change.
 *
 * @param value - Raw episode name.
 * @returns The normalized episode name.
 */
function normalizeEpisodeName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const collapsed = value.replace(/\s+/g, ' ').trim().toLowerCase();

  // The episode number is the only reliable part of the label.
  const digits = collapsed.replace(/\D/g, '');

  if (digits.length > 0) {
    return digits.replace(/^0+(?=\d)/, '');
  }

  return collapsed;
}

/**
 * Converts a value into a timestamp.
 *
 * @param value - Date, ISO string or number.
 * @returns The timestamp, or `undefined` when the value is not a usable date.
 */
function toTimestamp(value: unknown): number | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.getTime();
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
  }

  return undefined;
}

/**
 * Checks whether two dates describe the same release year.
 *
 * The source only reports a year: the importer stores the first day of that
 * year in UTC while the crawler stores it in the local timezone. The two dates
 * can therefore be one day apart, which is tolerated here.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns `true` when both values fall on the same year.
 */
function isSameReleaseDate(left: unknown, right: unknown): boolean {
  const leftTime = toTimestamp(left);
  const rightTime = toTimestamp(right);

  if (leftTime === undefined || rightTime === undefined) {
    return left === right;
  }

  // The dates are one day apart: they describe the same release year.
  if (Math.abs(leftTime - rightTime) < 24 * 60 * 60 * 1000) {
    return true;
  }

  return new Date(leftTime).getUTCFullYear() === new Date(rightTime).getUTCFullYear();
}

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
 * Tags of the HTML markup removed before comparing two summaries.
 */
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/gi;

/**
 * Normalizes a summary so two spellings of the same text compare equal.
 *
 * The summaries stored by the crawler are plain text while the payloads of the
 * sources sometimes carry HTML markup: the markup and the whitespace are
 * removed before the comparison.
 *
 * @param value - Raw summary.
 * @returns The normalized summary.
 */
function normalizeContent(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(HTML_TAG_PATTERN, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compares two summaries.
 *
 * @param left - First summary.
 * @param right - Second summary.
 * @returns `true` when both summaries hold the same text.
 */
function isSameContent(left: unknown, right: unknown): boolean {
  if (isSameValue(left, right)) {
    return true;
  }

  const leftText = normalizeContent(left);
  const rightText = normalizeContent(right);

  if (leftText.length === 0 || rightText.length === 0) {
    return false;
  }

  return leftText === rightText;
}

/**
 * Compares two arrays of strings, ignoring the order and the case.
 *
 * The comparison is a set comparison: a value that is present in both arrays
 * is ignored, whatever its position. The length is therefore not compared:
 * the database may hold more values than the file (e.g. a longer cast that the
 * source no longer reports), which is not a change of the movie.
 *
 * @param left - First array.
 * @param right - Second array.
 * @returns `true` when both arrays contain the same values.
 */
function isSameStringSet(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  const normalize = (values: unknown[]): string[] =>
    values.map((value) => normalizeText(String(value ?? ''))).filter((value) => value.length > 0);

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);

  // Every value of the incoming payload must already be known.
  return normalizedRight.every((value) => normalizedLeft.includes(value));
}

/**
 * Checks whether two episode server lists describe the same episodes.
 *
 * The comparison is done server by server: the name of the server and the
 * whole content of every episode (name, links) must be identical.
 *
 * @param left - First list of servers.
 * @param right - Second list of servers.
 * @returns `true` when both lists hold the same servers and episodes.
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
            .map(
              (episode) =>
                [
                  episode.slug.toLowerCase(),
                  normalizeEpisodeName(episode.name),
                  episode.link_embed,
                  episode.link_m3u8,
                ].join('|'),
            )
            .join(',')}`,
      )
      .sort();

  const summarizedLeft = summarize(left);
  const summarizedRight = summarize(right);

  return summarizedLeft.every((value, index) => value === summarizedRight[index]);
}

/**
 * Compares the value of a field between the database and the incoming file.
 *
 * @param field - Name of the field.
 * @param currentValue - Value stored in MongoDB.
 * @param incomingValue - Value coming from the TXT file.
 * @param backupValue - Value of the backup field of the document, used when the
 *   field was migrated (e.g. the URL of the source image).
 * @returns `true` when both values are equivalent.
 */
function isSameFieldValue(
  field: string,
  currentValue: unknown,
  incomingValue: unknown,
  backupValue?: unknown,
): boolean {
  if (field === 'episodes') {
    return isSameEpisodeSet(currentValue, incomingValue);
  }

  if (field === 'actor' || field === 'director') {
    return isSameStringSet(currentValue, incomingValue);
  }

  if (field === 'categories' || field === 'countries') {
    // The relations are compared by their name: the slug is derived from the
    // name and the master data may carry a different one.
    const toNames = (values: unknown): string[] => {
      if (!Array.isArray(values)) {
        return [];
      }

      return values
        .map((value) => {
          if (typeof value === 'string') {
            return value;
          }

          const name = (value as { name?: unknown })?.name;
          return typeof name === 'string' ? name : '';
        })
        .map((value) => normalizeText(value))
        .filter((value) => value.length > 0);
    };

    const currentNames = toNames(currentValue);
    const incomingNames = toNames(incomingValue);

    return (
      currentNames.length === incomingNames.length &&
      incomingNames.every((value) => currentNames.includes(value))
    );
  }

  if (field === 'trailer') {
    return isSameManagedObject(currentValue, incomingValue, MANAGED_TRAILER_KEYS);
  }

  if (field === 'tmdb') {
    return isSameManagedObject(currentValue, incomingValue, MANAGED_TMDB_KEYS);
  }

  if (field === 'releaseDate') {
    return isSameReleaseDate(currentValue, incomingValue);
  }

  if (field === 'content') {
    return isSameContent(currentValue, incomingValue);
  }

  if (IMAGE_BACKUP_FIELDS.has(field)) {
    // The image was migrated to Cloudinary: the document holds the new URL and
    // the URL of the source in the backup field. The file still carries the
    // URL of the source, therefore both values are compared.
    if (isSameValue(currentValue, incomingValue)) {
      return true;
    }

    if (
      backupValue !== undefined &&
      backupValue !== null &&
      isSameValue(backupValue, incomingValue)
    ) {
      return true;
    }

    // The document holds a migrated Cloudinary URL and the file carries the
    // URL of the original image: the two are never equal, but the migrated
    // image must not be replaced by the raw URL of the source. The importer
    // never uploads anything, therefore the Cloudinary URL is kept.
    if (isCloudinaryUrl(currentValue)) {
      return true;
    }

    return false;
  }

  return isSameValue(currentValue, incomingValue);
}

/**
 * Builds the comparison of a single field.
 *
 * @param field - Name of the field.
 * @param currentValue - Value stored in MongoDB.
 * @param incomingValue - Value coming from the TXT file.
 * @param backupValue - Value of the backup field of the document, used when the
 *   field was migrated (e.g. the URL of the source image).
 * @returns The comparison of the field.
 */
function compareField(
  field: string,
  currentValue: unknown,
  incomingValue: unknown,
  backupValue?: unknown,
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

  const same = isSameFieldValue(field, currentValue, incomingValue, backupValue);

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

    const backupField = IMAGE_BACKUP_FIELDS.get(field as string);
    const backupValue =
      existing && backupField
        ? (existing as unknown as Record<string, unknown>)[backupField]
        : undefined;

    diffs.push(compareField(field as string, currentValue, incomingValue, backupValue));
  }

  diffs.push(compareField('actor', existing?.actor, mapped.actor));
  diffs.push(compareField('director', existing?.director, mapped.director));
  diffs.push(compareField('episodes', existing?.episodes, mapped.episodes));

  // The categories, the countries, the format and the year do not live on the
  // `Movie` document: they are stored in the junction collections of the
  // crawler. They are compared as well so that the user can decide to
  // refresh them.
  //
  // When the relations could not be read from the junction collections (the
  // collection is missing, the read failed, ...), the comparison is impossible:
  // the incoming values would then overwrite relations that were never
  // compared. The fields are therefore reported as missing, which keeps the
  // database values and never prevents the importer from recognizing an
  // already up-to-date movie.
  const relationsAvailable = !existing || existing.relationsLoaded === true;

  if (relationsAvailable) {
    diffs.push(compareField('categories', existing?.categories, mapped.categories));
    diffs.push(compareField('countries', existing?.countries, mapped.countries));
    diffs.push(compareField('quality', existing?.quality, mapped.quality));
    diffs.push(compareField('year', existing?.year, mapped.year));
  } else {
    diffs.push(compareField('categories', existing?.categories, undefined));
    diffs.push(compareField('countries', existing?.countries, undefined));
    diffs.push(compareField('quality', existing?.quality, undefined));
    diffs.push(compareField('year', existing?.year, undefined));
  }

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

  // An ambiguous match has no target document yet: the fields that can be
  // written are unknown until the user picks one of the candidates.
  const isAmbiguous = match.status === MatchStatus.AMBIGUOUS && !match.movie;

  const updatableFields = diffs
    .filter((diff) => {
      if (diff.isProtected) {
        return false;
      }

      if (isAmbiguous) {
        return false;
      }

      if (isNew) {
        // A brand new document receives every field that carries a usable value.
        return diff.status === FieldStatus.CHANGED || diff.status === FieldStatus.UNCHANGED;
      }

      return diff.status === FieldStatus.CHANGED;
    })
    .map((diff) => diff.field);

  // The fields that actually differ between the database document and the
  // incoming file. A field that is missing from the file is never a change:
  // the value already stored in MongoDB is simply kept. The derived fields
  // are ignored here: they are recomputed from the title and must not prevent
  // the importer from recognizing an already up-to-date movie.
  const changedFields = diffs
    .filter(
      (diff) =>
        diff.status === FieldStatus.CHANGED &&
        diff.isProtected !== true &&
        !DERIVED_FIELDS.has(diff.field),
    )
    .map((diff) => diff.field);

  return {
    fileId,
    matchStatus: match.status as MovieComparison['matchStatus'],
    matchedBy: match.matchedBy,
    existing: match.movie,
    candidates: match.candidates,
    diffs,
    updatableFields,
    // A movie that does not exist yet always brings something to write.
    hasChanges: isNew || changedFields.length > 0,
    changedFields,
  };
}

/**
 * Resolves the target document of an ambiguous match and rebuilds the
 * comparison against it.
 *
 * An ambiguous match carries several candidates and no target document: the
 * fields that can be written are unknown until the user picks one of the
 * candidates. Without this step, the importer would overwrite every field of
 * the chosen document without ever comparing it with the incoming file.
 *
 * @param fileId - Identifier of the file the comparison belongs to.
 * @param mapped - The mapped movie coming from the TXT file.
 * @param comparison - The comparison built when the file was parsed.
 * @param targetMovieId - Identifier of the document picked by the user.
 * @returns The comparison against the chosen document, or the original
 *   comparison when the target is unknown.
 */
export function resolveAmbiguousTarget(
  fileId: string,
  mapped: MappedMovie,
  comparison: MovieComparison,
  targetMovieId: string | undefined,
): MovieComparison {
  if (comparison.matchStatus !== MatchStatus.AMBIGUOUS) {
    return comparison;
  }

  if (!targetMovieId) {
    return comparison;
  }

  const target = comparison.candidates.find((candidate) => candidate._id === targetMovieId);

  if (!target) {
    return comparison;
  }

  return buildComparison(fileId, mapped, {
    status: MatchStatus.MATCHED,
    matchedBy: comparison.matchedBy,
    movie: target,
    candidates: comparison.candidates,
  });
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
