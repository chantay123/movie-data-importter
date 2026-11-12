import type {
  MappedMovie,
  RawMovieJson,
  ValidationIssue,
} from '../types/movieImport.types';

/**
 * Validation of the parsed payload.
 *
 * The validator never modifies the data: it only reports the problems that
 * prevent a movie from being written to MongoDB safely.
 */

/**
 * Maximum length accepted by the `name` field of the MongoDB schema.
 */
const MAX_NAME_LENGTH = 500;

/**
 * Validates the parsed payload and the mapped movie.
 *
 * @param raw - Raw payload extracted from the TXT file.
 * @param mapped - Mapped movie produced by the mapper.
 * @returns The list of validation issues, ordered by severity.
 */
export function validateMovie(raw: RawMovieJson, mapped: MappedMovie): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!mapped.name || mapped.name.trim().length === 0) {
    issues.push({
      field: 'name',
      message: 'The movie name is required',
      severity: 'error',
    });
  } else if (mapped.name.length > MAX_NAME_LENGTH) {
    issues.push({
      field: 'name',
      message: `The movie name exceeds ${MAX_NAME_LENGTH} characters`,
      severity: 'error',
    });
  }

  const year = raw.info?.year;
  if (year !== undefined && year !== null && year !== '') {
    const numericYear = typeof year === 'number' ? year : Number.parseInt(String(year), 10);
    if (!Number.isInteger(numericYear) || numericYear < 1000 || numericYear > 3000) {
      issues.push({
        field: 'info.year',
        message: `The release year "${String(year)}" is not a valid year`,
        severity: 'warning',
      });
    }
  }

  const episodeCurrent = raw.info?.episodeCurrent;
  const episodeTotal = raw.info?.episodeTotal;

  if (episodeCurrent !== undefined && episodeCurrent !== null && episodeCurrent !== '') {
    const numeric = typeof episodeCurrent === 'number' ? episodeCurrent : Number(episodeCurrent);
    if (!Number.isFinite(numeric) || numeric < 0) {
      issues.push({
        field: 'info.episodeCurrent',
        message: 'The current episode count is not a positive number',
        severity: 'warning',
      });
    }
  }

  if (episodeTotal !== undefined && episodeTotal !== null && episodeTotal !== '') {
    const numeric = typeof episodeTotal === 'number' ? episodeTotal : Number(episodeTotal);
    if (!Number.isFinite(numeric) || numeric < 0) {
      issues.push({
        field: 'info.episodeTotal',
        message: 'The total episode count is not a positive number',
        severity: 'warning',
      });
    }
  }

  if (
    mapped.actor &&
    mapped.actor.some((actor) => actor.trim().length === 0)
  ) {
    issues.push({
      field: 'actors',
      message: 'Some actors have an empty name and were removed',
      severity: 'warning',
    });
  }

  if (
    mapped.episodes &&
    mapped.episodes.some((server) => server.server_data.length === 0)
  ) {
    issues.push({
      field: 'sources',
      message: 'Some servers have no usable episode',
      severity: 'warning',
    });
  }

  if (
    mapped.episodes &&
    mapped.episodes.some((server) =>
      server.server_data.some(
        (episode) =>
          !episode.link_embed &&
          !episode.link_m3u8,
      ),
    )
  ) {
    issues.push({
      field: 'sources',
      message: 'Some episodes have no playable link',
      severity: 'warning',
    });
  }

  return issues;
}

/**
 * Checks whether a set of issues prevents the movie from being imported.
 *
 * @param issues - Issues to evaluate.
 * @returns `true` when at least one issue has the `error` severity.
 */
export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
