import { Router, type Request, type Response } from 'express';
import { appConfig, hasDatabaseConfig } from '../config/app.config';
import { getDatabaseStatus } from '../database/mongo-client';
import { FieldStatus, ImportStatus, MatchStatus, SkipReason } from '../constants/importStatus';
import { requireAdmin } from '../middleware/adminAuth';
import {
  addLog,
  cancelJob,
  createJob,
  getComparisons,
  getComparison,
  getFileContent,
  getJob,
  isCancelled,
  jobEvents,
  listJobs,
  persistHistory,
  processFile,
  readHistory,
  updateFile,
} from '../services/importJob.service';
import { buildLogEntry, importMovie } from '../services/movieImport.service';
import { resolveAmbiguousTarget } from '../services/movieDiff.service';

/**
 * HTTP API of the importer.
 */
export const importRouter = Router();

/**
 * Maximum number of characters accepted for a single uploaded file.
 */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/**
 * Body of the import confirmation endpoint.
 */
interface ConfirmBody {
  fileId?: string;
  selectedFields?: string[];
  dryRun?: boolean;
  targetMovieId?: string;
}

/**
 * Shape of an uploaded file.
 */
interface UploadedFile {
  name: string;
  /**
   * Path of the file relative to the uploaded folder.
   *
   * It identifies the file inside the job: two files of different sub-folders
   * can share the same name.
   */
  path: string;
  size: number;
  content: string;
}

/**
 * Reports the health of the importer and of the database connection.
 */
importRouter.get('/health', (_req: Request, res: Response) => {
  const database = getDatabaseStatus();

  res.json({
    success: true,
    database: {
      ...database,
      configured: hasDatabaseConfig(),
    },
    limits: {
      maxConcurrency: appConfig.maxConcurrency,
      maxFileSize: appConfig.maxFileSize,
    },
  });
});

/**
 * Lists the known import jobs.
 */
importRouter.get('/jobs', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, jobs: listJobs() });
});

/**
 * Returns the state of a job, including the comparisons of every file.
 */
importRouter.get('/jobs/:jobId', requireAdmin, (req: Request, res: Response) => {
  const job = getJob(req.params['jobId'] ?? '');

  if (!job) {
    res.status(404).json({ success: false, message: 'Job not found' });
    return;
  }

  res.json({ success: true, job, comparisons: getComparisons(job.id) });
});

/**
 * Cancels a running job.
 */
importRouter.post('/jobs/:jobId/cancel', requireAdmin, (req: Request, res: Response) => {
  const cancelled = cancelJob(req.params['jobId'] ?? '');

  if (!cancelled) {
    res.status(404).json({ success: false, message: 'Job not found' });
    return;
  }

  res.json({ success: true, message: 'The job was cancelled' });
});

/**
 * Returns the comparison of a single file.
 */
importRouter.get('/jobs/:jobId/files/:fileId/comparison', requireAdmin, (req: Request, res: Response) => {
  const comparison = getComparison(req.params['jobId'] ?? '', req.params['fileId'] ?? '');

  if (!comparison) {
    res.status(404).json({ success: false, message: 'Comparison not found' });
    return;
  }

  res.json({ success: true, comparison });
});

/**
 * Returns the parsed JSON of a file.
 */
importRouter.get('/jobs/:jobId/files/:fileId/json', requireAdmin, (req: Request, res: Response) => {
  const job = getJob(req.params['jobId'] ?? '');
  const file = job?.files.find((entry) => entry.id === req.params['fileId']);

  if (!file) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }

  res.json({
    success: true,
    fileName: file.fileName,
    sourceFormat: file.sourceFormat,
    raw: file.parsed?.raw ?? null,
    extracted: file.parsed?.extracted ?? null,
    mapped: file.parsed?.mapped ?? null,
    unmappedFields: file.parsed?.unmappedFields ?? [],
    issues: file.parsed?.issues ?? [],
  });
});

/**
 * Returns every parsed JSON of a job.
 */
importRouter.get('/jobs/:jobId/export', requireAdmin, (req: Request, res: Response) => {
  const job = getJob(req.params['jobId'] ?? '');

  if (!job) {
    res.status(404).json({ success: false, message: 'Job not found' });
    return;
  }

  const mode = String(req.query['mode'] ?? 'raw');
  const payload = job.files
    .filter((file) => file.parsed)
    .map((file) => ({
      fileName: file.fileName,
      sourceFormat: file.sourceFormat,
      data:
        mode === 'mapped'
          ? file.parsed?.mapped
          : mode === 'extracted'
            ? file.parsed?.extracted
            : file.parsed?.raw ?? file.parsed?.extracted,
    }));

  res.json({ success: true, mode, count: payload.length, movies: payload });
});

/**
 * Starts a new import job from a list of uploaded files.
 *
 * The endpoint accepts a JSON body with the content of the files, which keeps
 * the payload compatible with every HTTP client.
 */
importRouter.post('/jobs', requireAdmin, (req: Request, res: Response) => {
  const body = req.body as {
    files?: Array<{ name?: string; path?: string; size?: number; content?: string }>;
  };

  const files = Array.isArray(body.files) ? body.files : [];

  if (files.length === 0) {
    res.status(400).json({ success: false, message: 'At least one file is required' });
    return;
  }

  const accepted: UploadedFile[] = [];
  const seenPaths = new Set<string>();

  for (const file of files) {
    const name = typeof file.name === 'string' ? file.name.trim() : '';

    if (!name || !name.toLowerCase().endsWith('.txt')) {
      continue;
    }

    const content = typeof file.content === 'string' ? file.content : '';
    const size = typeof file.size === 'number' ? file.size : Buffer.byteLength(content, 'utf8');

    if (size > MAX_UPLOAD_SIZE) {
      continue;
    }

    // The relative path is the identity of a file inside a folder. It is
    // optional for the clients that only send a flat list of files.
    const path = typeof file.path === 'string' && file.path.trim().length > 0
      ? file.path.trim()
      : name;

    if (seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    accepted.push({ name, path, size, content });
  }

  if (accepted.length === 0) {
    res.status(400).json({ success: false, message: 'No valid .txt file was received' });
    return;
  }

  const job = createJob(
    accepted.map((file) => ({
      path: file.path,
      name: file.name,
      size: file.size,
      content: file.content,
    })),
  );

  res.status(202).json({ success: true, jobId: job.id, total: accepted.length });

  void runJob(job.id, accepted);
});

/**
 * Runs a job: every file is processed with a bounded concurrency.
 *
 * @param jobId - Identifier of the job.
 * @param files - The files to process.
 */
async function runJob(jobId: string, files: UploadedFile[]): Promise<void> {
  const job = getJob(jobId);
  if (!job) {
    return;
  }

  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const queue = [...job.files];
  const concurrency = Math.max(1, appConfig.maxConcurrency);

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (isCancelled(jobId)) {
        return;
      }

      const next = queue.shift();
      if (!next) {
        return;
      }

      const content = byPath.get(next.filePath ?? next.fileName) ?? '';
      await processFile(jobId, next.id, content);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const finished = getJob(jobId);
  if (finished) {
    persistHistory(finished);
  }
}

/**
 * Retries a single failed file.
 */
importRouter.post('/jobs/:jobId/files/:fileId/retry', requireAdmin, async (req: Request, res: Response) => {
  const jobId = req.params['jobId'] ?? '';
  const fileId = req.params['fileId'] ?? '';
  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({ success: false, message: 'Job not found' });
    return;
  }

  const file = job.files.find((entry) => entry.id === fileId);
  if (!file) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }

  const body = req.body as { content?: string };
  const content =
    typeof body.content === 'string' && body.content.trim().length > 0
      ? body.content
      : (getFileContent(jobId, file.filePath ?? file.fileName) ?? '');

  if (content.trim().length === 0) {
    res.status(400).json({
      success: false,
      message: 'The content of the file is required to retry it',
    });
    return;
  }

  updateFile(jobId, fileId, {
    status: ImportStatus.WAITING,
    error: undefined,
    imported: false,
    skipReason: undefined,
    alreadyExists: undefined,
    changedFields: undefined,
  });

  res.status(202).json({ success: true, message: 'The file is being retried' });

  void processFile(jobId, fileId, content);
});

/**
 * Imports a single reviewed movie into MongoDB.
 */
importRouter.post('/jobs/:jobId/files/:fileId/import', requireAdmin, async (req: Request, res: Response) => {
  const jobId = req.params['jobId'] ?? '';
  const fileId = req.params['fileId'] ?? '';
  const body = req.body as ConfirmBody;

  const job = getJob(jobId);
  const file = job?.files.find((entry) => entry.id === fileId);

  if (!job || !file) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }

  const comparison = getComparison(jobId, fileId);
  const parsed = file.parsed;

  if (!comparison || !parsed?.mapped) {
    res.status(400).json({ success: false, message: 'The file was not parsed yet' });
    return;
  }

  if (comparison.matchStatus === MatchStatus.AMBIGUOUS && !body.targetMovieId) {
    res.status(400).json({
      success: false,
      message:
        'Several documents match this movie, the target document must be selected explicitly',
    });
    return;
  }

  const dryRun = body.dryRun !== false;

  // The target of an ambiguous match is chosen by the user: the comparison is
  // rebuilt against it so that only the fields that really differ are written.
  const targetComparison = resolveAmbiguousTarget(
    fileId,
    parsed.mapped,
    comparison,
    body.targetMovieId,
  );

  const target =
    targetComparison.existing ??
    comparison.candidates.find((candidate) => candidate._id === body.targetMovieId);

  // The movie already exists and the file brings nothing new: there is
  // nothing to write. The file is marked as "already there" and skipped.
  if (targetComparison.existing && !targetComparison.hasChanges) {
    updateFile(jobId, fileId, {
      status: ImportStatus.SKIPPED,
      skipReason: SkipReason.ALREADY_EXISTS,
      alreadyExists: true,
      changedFields: [],
      imported: false,
      error: undefined,
    });

    res.json({
      success: true,
      skipped: true,
      message:
        'The movie already exists in MongoDB and the file brings no change: the import was skipped',
    });
    return;
  }

  const selectedFields = Array.isArray(body.selectedFields)
    ? body.selectedFields
    : targetComparison.updatableFields;

  // A brand new document must carry the fields required by the `Movie` schema,
  // otherwise the write would fail with an obscure validation error.
  if (!target && selectedFields.length === 0) {
    res.status(400).json({
      success: false,
      message:
        'No field was selected. A new document needs at least the "name" and "slug" fields.',
    });
    return;
  }

  updateFile(jobId, fileId, { status: ImportStatus.PROCESSING, error: undefined });

  try {
    const outcome = await importMovie(fileId, file.fileName, parsed.mapped, parsed.raw, target, {
      selectedFields,
      dryRun,
      targetMovieId: body.targetMovieId,
    });

    const log = buildLogEntry(fileId, file.fileName, parsed.mapped, outcome, dryRun);
    addLog(jobId, log);

    if (outcome.error) {
      updateFile(jobId, fileId, { status: ImportStatus.FAILED, error: outcome.error });
      res.status(500).json({ success: false, message: outcome.error, log });
      return;
    }

    if (dryRun) {
      // Nothing was written: the file stays in the `PARSED` state so the
      // panel never reports a movie as imported when it was not.
      updateFile(jobId, fileId, {
        status: ImportStatus.PARSED,
        imported: false,
        error: undefined,
      });

      res.json({ success: true, dryRun, log, outcome });
      return;
    }

    updateFile(jobId, fileId, {
      status: ImportStatus.SUCCESS,
      existingMovieId: outcome.movieId ?? file.existingMovieId,
      imported: true,
    });

    res.json({ success: true, dryRun, log, outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    updateFile(jobId, fileId, { status: ImportStatus.FAILED, error: message });

    res.status(500).json({ success: false, message });
  }
});

/**
 * Returns the import history.
 */
importRouter.get('/history', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, history: readHistory() });
});

/**
 * Streams the job updates over Server-Sent Events.
 */
importRouter.get('/jobs/:jobId/stream', requireAdmin, (req: Request, res: Response) => {
  const jobId = req.params['jobId'] ?? '';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const job = getJob(jobId);
  if (job) {
    res.write(`event: job:updated\ndata: ${JSON.stringify({ type: 'job:updated', job })}\n\n`);
  }

  const listener = (event: unknown): void => {
    const typed = event as { type?: string; jobId?: string };
    if (typed.jobId && typed.jobId !== jobId) {
      return;
    }

    res.write(`event: ${typed.type ?? 'message'}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  jobEvents.on('event', listener);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    jobEvents.off('event', listener);
    res.end();
  });
});

/**
 * Lists the fields that can be updated for a given comparison.
 */
importRouter.get('/fields', requireAdmin, (_req: Request, res: Response) => {
  res.json({
    success: true,
    fields: [
      { name: 'name', label: 'Tên phim', mergeStrategy: 'REPLACE' },
      { name: 'originName', label: 'Tên gốc', mergeStrategy: 'REPLACE' },
      { name: 'content', label: 'Nội dung', mergeStrategy: 'REPLACE' },
      { name: 'slug', label: 'Slug', mergeStrategy: 'REPLACE' },
      { name: 'sourceId', label: 'Source ID', mergeStrategy: 'REPLACE' },
      { name: 'releaseDate', label: 'Ngày phát hành', mergeStrategy: 'REPLACE' },
      { name: 'time', label: 'Thời lượng', mergeStrategy: 'REPLACE' },
      { name: 'episodeCurrent', label: 'Số tập hiện tại', mergeStrategy: 'REPLACE' },
      { name: 'episodeTotal', label: 'Tổng số tập', mergeStrategy: 'REPLACE' },
      { name: 'lang', label: 'Ngôn ngữ', mergeStrategy: 'REPLACE' },
      { name: 'thumbUrl', label: 'Ảnh thumbnail', mergeStrategy: 'REPLACE' },
      { name: 'posterUrl', label: 'Ảnh poster', mergeStrategy: 'REPLACE' },
      { name: 'trailer', label: 'Trailer', mergeStrategy: 'REPLACE' },
      { name: 'tmdb', label: 'TMDB', mergeStrategy: 'REPLACE' },
      { name: 'actor', label: 'Diễn viên', mergeStrategy: 'UNION' },
      { name: 'director', label: 'Đạo diễn', mergeStrategy: 'UNION' },
      { name: 'episodes', label: 'Tập phim', mergeStrategy: 'UNION' },
    ],
    fieldStatuses: Object.values(FieldStatus),
  });
});
