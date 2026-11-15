import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config/app.config';
import {
  ImportOperation,
  ImportStatus,
  MatchStatus,
  ProcessingStage,
  SkipReason,
} from '../constants/importStatus';
import type {
  FileProgress,
  ImportEvent,
  ImportJob,
  ImportLogEntry,
  JobCounters,
  MovieComparison,
} from '../types/movieImport.types';
import { buildComparison } from './movieDiff.service';
import { findMatchingMovie } from './movieMatcher.service';
import { parseMovieFile } from './textParser.service';

/**
 * Orchestration of the import jobs.
 *
 * The manager keeps the state of every job in memory so the admin panel can
 * resume its monitoring after a page reload, and emits an event for every
 * state change so the frontend can display the progress in real time.
 */

interface JobState {
  job: ImportJob;
  comparisons: Map<string, MovieComparison>;
  cancelled: boolean;
  /** Raw content of every uploaded file, kept so a file can be retried alone. */
  contents: Map<string, string>;
  /**
   * Identity of the movie targeted by every processed file, indexed by the
   * identity key.
   *
   * It is used to detect two files of the same batch that target the same
   * movie: the second one is skipped instead of being applied twice.
   */
  claims: Map<string, string>;
}

/**
 * In-memory registry of the import jobs.
 */
const jobs = new Map<string, JobState>();

/**
 * Event bus used to broadcast the job updates to the SSE endpoints.
 */
export const jobEvents = new EventEmitter();

jobEvents.setMaxListeners(0);

/**
 * Sequence used to build the unique file identifiers.
 */
let fileSequence = 0;

/**
 * Recomputes the counters of a job.
 *
 * @param job - The job to update.
 * @returns The refreshed counters.
 */
export function recountJob(job: ImportJob): JobCounters {
  const files = Array.isArray(job?.files) ? job.files : [];
  const logs = Array.isArray(job?.logs) ? job.logs : [];

  const counters: JobCounters = {
    total: files.length,
    processed: 0,
    success: 0,
    failed: 0,
    needsReview: 0,
    skipped: 0,
    cancelled: 0,
    processing: 0,
    parsed: 0,
    imported: 0,
    unchanged: 0,
    overallProgress: 0,
  };

  for (const file of files) {
    if (file.status === ImportStatus.SUCCESS) {
      counters.success += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.FAILED) {
      counters.failed += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.PARSED) {
      counters.parsed += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.NEEDS_REVIEW) {
      counters.needsReview += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.SKIPPED) {
      counters.skipped += 1;
      counters.processed += 1;

      // A file skipped because the movie already exists and brings no change
      // is counted separately: it is not an error, it is a duplicate.
      if (file.skipReason === SkipReason.ALREADY_EXISTS) {
        counters.unchanged += 1;
      }
    } else if (file.status === ImportStatus.CANCELLED) {
      counters.cancelled += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.PROCESSING) {
      counters.processing += 1;
    }
  }

  // Only the writes that actually reached MongoDB are counted: a dry run
  // produces a log entry too, but nothing was written.
  counters.imported = logs.filter((log) => log.imported === true).length;

  if (counters.total > 0) {
    counters.overallProgress = Math.round((counters.processed / counters.total) * 100);
  }

  return counters;
}

/**
 * Emits an event to the listeners of the SSE stream.
 *
 * @param event - The event to broadcast.
 */
function emit(event: ImportEvent): void {
  jobEvents.emit('event', event);
}

/**
 * Updates the state of a file and broadcasts the change.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @param patch - The fields to update.
 * @returns The updated file progress.
 */
export function updateFile(
  jobId: string,
  fileId: string,
  patch: Partial<FileProgress>,
): FileProgress | undefined {
  const state = jobs.get(jobId);
  if (!state) {
    return undefined;
  }

  const file = state.job.files.find((entry) => entry.id === fileId);
  if (!file) {
    return undefined;
  }

  Object.assign(file, patch);
  state.job.counters = recountJob(state.job);
  state.job.updatedAt = new Date().toISOString();

  emit({ type: 'file:updated', file, jobId });
  emit({ type: 'job:updated', job: state.job });

  return file;
}

/**
 * Description of a file that belongs to a job.
 */
export interface JobFileInput {
  /**
   * Identifier of the file inside the job.
   *
   * It is the path relative to the uploaded folder: two files living in
   * different sub-folders can share the same name.
   */
  path: string;
  /** Name of the file, without its folder. */
  name: string;
  /** Size of the file in bytes. */
  size: number;
  /** Raw content of the file. */
  content?: string;
}

/**
 * Creates a new import job.
 *
 * @param files - Description of every file to process.
 * @returns The created job.
 */
export function createJob(files: JobFileInput[]): ImportJob {
  const id = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const fileProgress: FileProgress[] = files.map((file) => ({
    id: `file_${++fileSequence}`,
    fileName: file.name,
    filePath: file.path,
    fileSize: file.size,
    status: ImportStatus.WAITING,
    stage: ProcessingStage.READING,
    progress: 0,
    readableFieldCount: 0,
    episodeCount: 0,
  }));

  const job: ImportJob = {
    id,
    createdAt: now,
    updatedAt: now,
    cancelled: false,
    counters: {
      total: fileProgress.length,
      processed: 0,
      success: 0,
      failed: 0,
      needsReview: 0,
      skipped: 0,
      cancelled: 0,
      processing: 0,
      parsed: 0,
      imported: 0,
      unchanged: 0,
      overallProgress: 0,
    },
    files: fileProgress,
    logs: [],
  };

  job.counters = recountJob(job);

  const contents = new Map<string, string>();

  for (const file of files) {
    if (file.content !== undefined) {
      contents.set(file.path, file.content);
    }
  }

  jobs.set(id, { job, comparisons: new Map(), cancelled: false, contents, claims: new Map() });

  emit({ type: 'job:created', job });

  return job;
}

/**
 * Returns the state of a job.
 *
 * @param jobId - Identifier of the job.
 * @returns The job or `undefined` when it does not exist.
 */
export function getJob(jobId: string): ImportJob | undefined {
  return jobs.get(jobId)?.job;
}

/**
 * Returns the comparison of a file.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @returns The comparison or `undefined`.
 */
export function getComparison(jobId: string, fileId: string): MovieComparison | undefined {
  return jobs.get(jobId)?.comparisons.get(fileId);
}

/**
 * Returns every comparison of a job.
 *
 * @param jobId - Identifier of the job.
 * @returns The list of comparisons.
 */
export function getComparisons(jobId: string): MovieComparison[] {
  const state = jobs.get(jobId);
  return state ? [...state.comparisons.values()] : [];
}

/**
 * Returns the raw content of an uploaded file.
 *
 * @param jobId - Identifier of the job.
 * @param fileName - Name of the file.
 * @returns The content or `undefined` when it is unknown.
 */
export function getFileContent(jobId: string, filePath: string): string | undefined {
  return jobs.get(jobId)?.contents.get(filePath);
}

/**
 * Stores the comparison of a file.
 *
 * @param jobId - Identifier of the job.
 * @param comparison - The comparison to store.
 */
export function setComparison(jobId: string, comparison: MovieComparison): void {
  jobs.get(jobId)?.comparisons.set(comparison.fileId, comparison);
}

/**
 * Adds a log entry to a job.
 *
 * @param jobId - Identifier of the job.
 * @param log - The log entry.
 */
export function addLog(jobId: string, log: ImportLogEntry): void {
  const state = jobs.get(jobId);
  if (!state) {
    return;
  }

  state.job.logs.push(log);
  state.job.counters = recountJob(state.job);
  state.job.updatedAt = new Date().toISOString();

  emit({ type: 'log:added', log, jobId });
  emit({ type: 'job:updated', job: state.job });
}

/**
 * Cancels a running job.
 *
 * @param jobId - Identifier of the job.
 * @returns `true` when the job was found and cancelled.
 */
export function cancelJob(jobId: string): boolean {
  const state = jobs.get(jobId);
  if (!state) {
    return false;
  }

  state.cancelled = true;
  state.job.cancelled = true;
  state.job.updatedAt = new Date().toISOString();

  for (const file of state.job.files) {
    if (file.status === ImportStatus.WAITING || file.status === ImportStatus.PROCESSING) {
      file.status = ImportStatus.CANCELLED;
      file.stage = ProcessingStage.COMPLETED;
      file.progress = 100;
      file.finishedAt = new Date().toISOString();
    }
  }

  state.job.counters = recountJob(state.job);

  emit({ type: 'job:updated', job: state.job });
  emit({ type: 'job:completed', job: state.job });

  return true;
}

/**
 * Checks whether a job was cancelled.
 *
 * @param jobId - Identifier of the job.
 * @returns `true` when the job was cancelled.
 */
export function isCancelled(jobId: string): boolean {
  return jobs.get(jobId)?.cancelled ?? false;
}

/**
 * Processes a single file: parse, map, validate and compare with the database.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @param content - Raw content of the file.
 * @returns The final progress of the file.
 */
export async function processFile(
  jobId: string,
  fileId: string,
  content: string,
): Promise<FileProgress | undefined> {
  const state = jobs.get(jobId);
  const file = state?.job.files.find((entry) => entry.id === fileId);

  if (!state || !file) {
    return undefined;
  }

  updateFile(jobId, fileId, {
    status: ImportStatus.PROCESSING,
    stage: ProcessingStage.READING,
    progress: 10,
    startedAt: new Date().toISOString(),
  });

  try {
    const parsed = parseMovieFile(file.fileName, file.fileSize, content);

    updateFile(jobId, fileId, {
      stage: ProcessingStage.EXTRACTING,
      progress: 30,
      detectedName: parsed.detectedName,
      readableFieldCount: parsed.readableFieldCount,
      episodeCount: parsed.episodeCount,
      serverCount: parsed.serverCount,
      sourceFormat: parsed.sourceFormat,
      parsed,
    });

    // A plain JSON document carries a `raw` payload, while a raw TXT file is
    // only represented by its `extracted` payload. Both are valid results, so
    // the guard must only reject the files that produced nothing at all.
    if (!parsed.mapped || (!parsed.raw && !parsed.extracted)) {
      updateFile(jobId, fileId, {
        status: ImportStatus.FAILED,
        stage: ProcessingStage.COMPLETED,
        progress: 100,
        error: parsed.issues.find((issue) => issue.severity === 'error')?.message ?? 'Parsing failed',
        finishedAt: new Date().toISOString(),
      });

      return getJob(jobId)?.files.find((entry) => entry.id === fileId);
    }

    updateFile(jobId, fileId, { stage: ProcessingStage.VALIDATING, progress: 50 });
    updateFile(jobId, fileId, { stage: ProcessingStage.MAPPING, progress: 60 });
    updateFile(jobId, fileId, { stage: ProcessingStage.COMPARING_DATABASE, progress: 75 });

    const match = await findMatchingMovie(parsed.mapped);
    const comparison = buildComparison(fileId, parsed.mapped, match);

    state.comparisons.set(fileId, comparison);

    const isAmbiguous = match.status === MatchStatus.AMBIGUOUS;
    const hasBlockingError = parsed.issues.some((issue) => issue.severity === 'error');

    // The movie already exists in MongoDB and the file brings nothing new:
    // the file is marked as "already there" and skipped. Nothing is written
    // and the file does not wait for a confirmation.
    const isAlreadyUpToDate =
      match.status === MatchStatus.MATCHED &&
      Boolean(match.movie) &&
      !comparison.hasChanges;

    // Another file of the same batch already targets the same movie: only the
    // first one is kept, the other ones are skipped.
    const targetKey = match.movie?._id ?? parsed.mapped.slug ?? parsed.mapped.sourceId;
    const ownerId = targetKey ? state.claims.get(targetKey) : undefined;
    const owner = ownerId
      ? state.job.files.find((entry) => entry.id === ownerId)
      : undefined;
    // The owner hands the movie over when it carries nothing to write (the
    // movie was already up-to-date) or when it failed.
    const ownerIsInactive =
      !owner ||
      owner.status === ImportStatus.SKIPPED ||
      owner.status === ImportStatus.FAILED ||
      owner.status === ImportStatus.CANCELLED;

    const duplicatedInBatch = Boolean(
      ownerId && ownerId !== fileId && !ownerIsInactive,
    );

    if (targetKey && (!ownerId || ownerId === fileId || ownerIsInactive)) {
      state.claims.set(targetKey, fileId);
    }

    if (hasBlockingError) {
      updateFile(jobId, fileId, {
        stage: ProcessingStage.COMPLETED,
        progress: 100,
        matchStatus: match.status,
        existingMovieId: match.movie?._id,
        status: ImportStatus.FAILED,
        error: parsed.issues.find((issue) => issue.severity === 'error')?.message,
        finishedAt: new Date().toISOString(),
      });

      return getJob(jobId)?.files.find((entry) => entry.id === fileId);
    }

    if (isAlreadyUpToDate) {
      updateFile(jobId, fileId, {
        stage: ProcessingStage.COMPLETED,
        progress: 100,
        matchStatus: match.status,
        existingMovieId: match.movie?._id,
        status: ImportStatus.SKIPPED,
        skipReason: SkipReason.ALREADY_EXISTS,
        alreadyExists: true,
        changedFields: [],
        imported: false,
        error: undefined,
        finishedAt: new Date().toISOString(),
      });

      addLog(jobId, {
        fileId,
        fileName: file.fileName,
        movieName: parsed.mapped.name ?? '(unknown)',
        slug: parsed.mapped.slug ?? '',
        movieId: match.movie?._id,
        operation: ImportOperation.NONE,
        updatedFields: [],
        status: ImportStatus.SKIPPED,
        imported: false,
        skipped: true,
        error: 'The movie already exists in MongoDB and the file brings no change',
        timestamp: new Date().toISOString(),
      });

      return getJob(jobId)?.files.find((entry) => entry.id === fileId);
    }

    if (duplicatedInBatch) {
      updateFile(jobId, fileId, {
        stage: ProcessingStage.COMPLETED,
        progress: 100,
        matchStatus: match.status,
        existingMovieId: match.movie?._id,
        status: ImportStatus.SKIPPED,
        skipReason: SkipReason.DUPLICATE_IN_BATCH,
        alreadyExists: Boolean(match.movie),
        changedFields: comparison.changedFields,
        imported: false,
        error: undefined,
        finishedAt: new Date().toISOString(),
      });

      addLog(jobId, {
        fileId,
        fileName: file.fileName,
        movieName: parsed.mapped.name ?? '(unknown)',
        slug: parsed.mapped.slug ?? '',
        movieId: match.movie?._id,
        operation: ImportOperation.NONE,
        updatedFields: [],
        status: ImportStatus.SKIPPED,
        imported: false,
        skipped: true,
        error: 'Another file of the same batch already targets this movie',
        timestamp: new Date().toISOString(),
      });

      return getJob(jobId)?.files.find((entry) => entry.id === fileId);
    }

    updateFile(jobId, fileId, {
      stage: ProcessingStage.COMPLETED,
      progress: 100,
      matchStatus: match.status,
      existingMovieId: match.movie?._id,
      alreadyExists: Boolean(match.movie),
      changedFields: comparison.changedFields,
      // The file is only parsed and compared at this point: nothing was
      // written into MongoDB yet. The write happens when the user confirms
      // the import, so the status is `PARSED` and not `SUCCESS`.
      status: isAmbiguous ? ImportStatus.NEEDS_REVIEW : ImportStatus.PARSED,
      error: undefined,
      finishedAt: new Date().toISOString(),
    });

    return getJob(jobId)?.files.find((entry) => entry.id === fileId);
  } catch (error) {
    updateFile(jobId, fileId, {
      status: ImportStatus.FAILED,
      stage: ProcessingStage.COMPLETED,
      progress: 100,
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    });

    return getJob(jobId)?.files.find((entry) => entry.id === fileId);
  }
}

/**
 * Lists the known jobs, most recent first.
 *
 * @returns The list of jobs.
 */
export function listJobs(): ImportJob[] {
  return [...jobs.values()]
    .map((state) => state.job)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * Persists the import history on disk so it survives a server restart.
 *
 * @param job - The job to persist.
 */
export function persistHistory(job: ImportJob): void {
  try {
    fs.mkdirSync(appConfig.historyDir, { recursive: true });

    const filePath = path.join(appConfig.historyDir, `${job.id}.json`);
    const payload = {
      id: job.id,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      logs: job.logs,
      files: job.files.map((file) => ({
        fileName: file.fileName,
        filePath: file.filePath,
        status: file.status,
        imported: file.imported,
        detectedName: file.detectedName,
        matchStatus: file.matchStatus,
        existingMovieId: file.existingMovieId,
        alreadyExists: file.alreadyExists,
        skipReason: file.skipReason,
        changedFields: file.changedFields,
        error: file.error,
        startedAt: file.startedAt,
        finishedAt: file.finishedAt,
      })),
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn(
      `[import] Unable to persist the import history: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Reads the import history persisted on disk.
 *
 * @returns The list of persisted runs, most recent first.
 */
export function readHistory(): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(appConfig.historyDir)) {
      return [];
    }

    return fs
      .readdirSync(appConfig.historyDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => {
        const raw = fs.readFileSync(path.join(appConfig.historyDir, fileName), 'utf8');
        return JSON.parse(raw) as Record<string, unknown>;
      })
      .sort((left, right) => String(right['createdAt']).localeCompare(String(left['createdAt'])));
  } catch (error) {
    console.warn(
      `[import] Unable to read the import history: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}
