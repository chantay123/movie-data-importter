import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config/app.config';
import {
  ImportStatus,
  MatchStatus,
  ProcessingStage,
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
    imported: 0,
    overallProgress: 0,
  };

  for (const file of files) {
    if (file.status === ImportStatus.SUCCESS) {
      counters.success += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.FAILED) {
      counters.failed += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.NEEDS_REVIEW) {
      counters.needsReview += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.SKIPPED) {
      counters.skipped += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.CANCELLED) {
      counters.cancelled += 1;
      counters.processed += 1;
    } else if (file.status === ImportStatus.PROCESSING) {
      counters.processing += 1;
    }
  }

  counters.imported = logs.filter((log) => log.status === ImportStatus.SUCCESS).length;

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
 * Creates a new import job.
 *
 * @param fileNames - Names of the files to process.
 * @param fileSizes - Sizes of the files, indexed by file name.
 * @param contents - Raw content of the files, indexed by file name.
 * @returns The created job.
 */
export function createJob(
  fileNames: string[],
  fileSizes: Map<string, number>,
  contents?: Map<string, string>,
): ImportJob {
  const id = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const files: FileProgress[] = fileNames.map((fileName) => ({
    id: `file_${++fileSequence}`,
    fileName,
    fileSize: fileSizes.get(fileName) ?? 0,
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
      total: files.length,
      processed: 0,
      success: 0,
      failed: 0,
      needsReview: 0,
      skipped: 0,
      cancelled: 0,
      processing: 0,
      imported: 0,
      overallProgress: 0,
    },
    files,
    logs: [],
  };

  job.counters = recountJob(job);

  jobs.set(id, { job, comparisons: new Map(), cancelled: false, contents: contents ?? new Map() });

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
export function getFileContent(jobId: string, fileName: string): string | undefined {
  return jobs.get(jobId)?.contents.get(fileName);
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

    updateFile(jobId, fileId, {
      stage: ProcessingStage.COMPLETED,
      progress: 100,
      matchStatus: match.status,
      existingMovieId: match.movie?._id,
      status: hasBlockingError
        ? ImportStatus.FAILED
        : isAmbiguous
          ? ImportStatus.NEEDS_REVIEW
          : ImportStatus.SUCCESS,
      error: hasBlockingError
        ? parsed.issues.find((issue) => issue.severity === 'error')?.message
        : undefined,
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
        status: file.status,
        detectedName: file.detectedName,
        matchStatus: file.matchStatus,
        existingMovieId: file.existingMovieId,
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
