import { MatchStatus } from '../constants/importStatus';
import { getMovieModel } from '../database/crawlerModels';
import { isDatabaseReady } from '../database/mongo-client';
import type {
  ExistingMovie,
  MappedMovie,
  MatchResult,
} from '../types/movieImport.types';
import { normalizeSlug, normalizeText } from '../utils/normalizeText';

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
  type: 1,
  availabilityStatus: 1,
  time: 1,
  episodeCurrent: 1,
  episodeTotal: 1,
  lang: 1,
  thumbUrl: 1,
  posterUrl: 1,
  backdropUrl: 1,
  chieurap: 1,
  notify: 1,
  showtimes: 1,
  name_normalized: 1,
  originName_normalized: 1,
  originalPosterUrl: 1,
  originalThumbUrl: 1,
  actor: 1,
  director: 1,
  episodes: 1,
  sourceId: 1,
  source: 1,
  'tmdb.id': 1,
  'tmdb.type': 1,
  'tmdb.season': 1,
  trailer: 1,
  updatedAt: 1,
} as const;

/**
 * Escapes the characters that have a special meaning inside a regular expression.
 *
 * @param value - Raw value.
 * @returns The escaped value.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a lean document into the reduced shape used by the importer.
 *
 * @param document - Lean document coming from MongoDB.
 * @returns The reduced movie.
 */
function toExistingMovie(document: Record<string, unknown>): ExistingMovie {
  const tmdb = document['tmdb'] as Record<string, unknown> | undefined;

  return {
    _id: String(document['_id']),
    name: document['name'] as string | undefined,
    slug: document['slug'] as string | undefined,
    originName: document['originName'] as string | undefined,
    content: document['content'] as string | undefined,
    releaseDate: document['releaseDate']
      ? new Date(document['releaseDate'] as string).toISOString()
      : null,
    status: document['status'] as string | undefined,
    type: document['type'] as string | undefined,
    availabilityStatus: document['availabilityStatus'] as string | undefined,
    time: document['time'] as string | undefined,
    episodeCurrent: document['episodeCurrent'] as string | undefined,
    episodeTotal: document['episodeTotal'] as string | undefined,
    lang: document['lang'] as string | undefined,
    thumbUrl: document['thumbUrl'] as string | undefined,
    posterUrl: document['posterUrl'] as string | undefined,
    backdropUrl: document['backdropUrl'] as string | undefined,
    chieurap: document['chieurap'] as boolean | undefined,
    notify: document['notify'] as string | undefined,
    showtimes: document['showtimes'] as string | undefined,
    name_normalized: document['name_normalized'] as string | undefined,
    originName_normalized: document['originName_normalized'] as string | undefined,
    originalPosterUrl: document['originalPosterUrl'] as string | undefined,
    originalThumbUrl: document['originalThumbUrl'] as string | undefined,
    actor: Array.isArray(document['actor']) ? (document['actor'] as string[]) : [],
    director: Array.isArray(document['director']) ? (document['director'] as string[]) : [],
    episodes: Array.isArray(document['episodes'])
      ? (document['episodes'] as ExistingMovie['episodes'])
      : [],
    sourceId: document['sourceId'] as string | undefined,
    source: document['source'] as string | undefined,
    tmdb: tmdb
      ? {
          id: tmdb['id'] as string | undefined,
          type: tmdb['type'] as string | undefined,
          season: (tmdb['season'] as number | null | undefined) ?? null,
        }
      : undefined,
    trailer: document['trailer'] as ExistingMovie['trailer'],
    updatedAt: document['updatedAt']
      ? new Date(document['updatedAt'] as string).toISOString()
      : undefined,
  };
}

/**
 * Runs a MongoDB query and converts the documents.
 *
 * @param query - The MongoDB filter.
 * @returns The matching documents.
 */
async function runQuery(query: Record<string, unknown>): Promise<ExistingMovie[]> {
  if (!isDatabaseReady()) {
    throw new Error(
      'MongoDB is not connected. Check the connection settings of the crawler project and restart the importer API.',
    );
  }

  const Movie = getMovieModel();
  const documents = (await Movie.find(query, MOVIE_PROJECTION).limit(20).lean()) as Array<
    Record<string, unknown>
  >;

  return documents.map(toExistingMovie);
}

/**
 * Looks a movie up inside MongoDB.
 *
 * @param mapped - The mapped movie coming from the TXT file.
 * @returns The result of the lookup.
 */
export async function findMatchingMovie(mapped: MappedMovie): Promise<MatchResult> {
  // 1. sourceId
  if (mapped.sourceId) {
    const bySource = await runQuery({ sourceId: mapped.sourceId });
    if (bySource.length === 1) {
      return { status: MatchStatus.MATCHED, matchedBy: 'sourceId', movie: bySource[0], candidates: bySource };
    }
    if (bySource.length > 1) {
      return {
        status: MatchStatus.AMBIGUOUS,
        matchedBy: 'sourceId',
        candidates: bySource,
        message: `${bySource.length} documents share the same sourceId`,
      };
    }
  }

  // 2. tmdb.id (+ type / season)
  const tmdbId = mapped.tmdb?.id;
  if (tmdbId) {
    const tmdbQuery: Record<string, unknown> = { 'tmdb.id': tmdbId };

    if (mapped.tmdb?.type) {
      tmdbQuery['tmdb.type'] = mapped.tmdb.type;
    }
    if (mapped.tmdb?.season !== undefined && mapped.tmdb?.season !== null) {
      tmdbQuery['tmdb.season'] = mapped.tmdb.season;
    }

    const byTmdb = await runQuery(tmdbQuery);
    if (byTmdb.length === 1) {
      return { status: MatchStatus.MATCHED, matchedBy: 'tmdb', movie: byTmdb[0], candidates: byTmdb };
    }
    if (byTmdb.length > 1) {
      return {
        status: MatchStatus.AMBIGUOUS,
        matchedBy: 'tmdb',
        candidates: byTmdb,
        message: `${byTmdb.length} documents share the same TMDB identifier`,
      };
    }
  }

  // 3. slug
  if (mapped.slug) {
    const bySlug = await runQuery({ slug: normalizeSlug(mapped.slug) });
    if (bySlug.length === 1) {
      return { status: MatchStatus.MATCHED, matchedBy: 'slug', movie: bySlug[0], candidates: bySlug };
    }
    if (bySlug.length > 1) {
      return {
        status: MatchStatus.AMBIGUOUS,
        matchedBy: 'slug',
        candidates: bySlug,
        message: `${bySlug.length} documents share the same slug`,
      };
    }
  }

  // 4. name
  const nameKey = normalizeText(mapped.name);
  if (nameKey) {
    const byName = await runQuery({
      name: { $regex: `^${escapeRegExp(mapped.name ?? '')}$`, $options: 'i' },
    });
    const exact = byName.filter((movie) => normalizeText(movie.name) === nameKey);

    if (exact.length === 1) {
      return { status: MatchStatus.MATCHED, matchedBy: 'name', movie: exact[0], candidates: exact };
    }
    if (exact.length > 1) {
      return {
        status: MatchStatus.AMBIGUOUS,
        matchedBy: 'name',
        candidates: exact,
        message: `${exact.length} documents share the same name`,
      };
    }
  }

  // 5. originName
  const originKey = normalizeText(mapped.originName);
  if (originKey && originKey !== nameKey) {
    const byOrigin = await runQuery({
      originName: { $regex: `^${escapeRegExp(mapped.originName ?? '')}$`, $options: 'i' },
    });
    const exact = byOrigin.filter((movie) => normalizeText(movie.originName) === originKey);

    if (exact.length === 1) {
      return {
        status: MatchStatus.MATCHED,
        matchedBy: 'originName',
        movie: exact[0],
        candidates: exact,
      };
    }
    if (exact.length > 1) {
      return {
        status: MatchStatus.AMBIGUOUS,
        matchedBy: 'originName',
        candidates: exact,
        message: `${exact.length} documents share the same origin name`,
      };
    }
  }

  return {
    status: MatchStatus.NEW,
    candidates: [],
    message: 'No document matches this movie yet',
  };
}