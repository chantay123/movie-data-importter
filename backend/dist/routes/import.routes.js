"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importRouter = void 0;
const express_1 = require("express");
const app_config_1 = require("../config/app.config");
const mongo_client_1 = require("../database/mongo-client");
const importStatus_1 = require("../constants/importStatus");
const adminAuth_1 = require("../middleware/adminAuth");
const importJob_service_1 = require("../services/importJob.service");
const movieImport_service_1 = require("../services/movieImport.service");
/**
 * HTTP API of the importer.
 */
exports.importRouter = (0, express_1.Router)();
/**
 * Maximum number of characters accepted for a single uploaded file.
 */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
/**
 * Reports the health of the importer and of the database connection.
 */
exports.importRouter.get('/health', (_req, res) => {
    const database = (0, mongo_client_1.getDatabaseStatus)();
    res.json({
        success: true,
        database: {
            ...database,
            configured: (0, app_config_1.hasDatabaseConfig)(),
        },
        limits: {
            maxConcurrency: app_config_1.appConfig.maxConcurrency,
            maxFileSize: app_config_1.appConfig.maxFileSize,
        },
    });
});
/**
 * Lists the known import jobs.
 */
exports.importRouter.get('/jobs', adminAuth_1.requireAdmin, (_req, res) => {
    res.json({ success: true, jobs: (0, importJob_service_1.listJobs)() });
});
/**
 * Returns the state of a job, including the comparisons of every file.
 */
exports.importRouter.get('/jobs/:jobId', adminAuth_1.requireAdmin, (req, res) => {
    const job = (0, importJob_service_1.getJob)(req.params['jobId'] ?? '');
    if (!job) {
        res.status(404).json({ success: false, message: 'Job not found' });
        return;
    }
    res.json({ success: true, job, comparisons: (0, importJob_service_1.getComparisons)(job.id) });
});
/**
 * Cancels a running job.
 */
exports.importRouter.post('/jobs/:jobId/cancel', adminAuth_1.requireAdmin, (req, res) => {
    const cancelled = (0, importJob_service_1.cancelJob)(req.params['jobId'] ?? '');
    if (!cancelled) {
        res.status(404).json({ success: false, message: 'Job not found' });
        return;
    }
    res.json({ success: true, message: 'The job was cancelled' });
});
/**
 * Returns the comparison of a single file.
 */
exports.importRouter.get('/jobs/:jobId/files/:fileId/comparison', adminAuth_1.requireAdmin, (req, res) => {
    const comparison = (0, importJob_service_1.getComparison)(req.params['jobId'] ?? '', req.params['fileId'] ?? '');
    if (!comparison) {
        res.status(404).json({ success: false, message: 'Comparison not found' });
        return;
    }
    res.json({ success: true, comparison });
});
/**
 * Returns the parsed JSON of a file.
 */
exports.importRouter.get('/jobs/:jobId/files/:fileId/json', adminAuth_1.requireAdmin, (req, res) => {
    const job = (0, importJob_service_1.getJob)(req.params['jobId'] ?? '');
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
exports.importRouter.get('/jobs/:jobId/export', adminAuth_1.requireAdmin, (req, res) => {
    const job = (0, importJob_service_1.getJob)(req.params['jobId'] ?? '');
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
        data: mode === 'mapped'
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
exports.importRouter.post('/jobs', adminAuth_1.requireAdmin, (req, res) => {
    const body = req.body;
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
        res.status(400).json({ success: false, message: 'At least one file is required' });
        return;
    }
    const accepted = [];
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
        accepted.push({ name, size, content });
    }
    if (accepted.length === 0) {
        res.status(400).json({ success: false, message: 'No valid .txt file was received' });
        return;
    }
    const sizes = new Map(accepted.map((file) => [file.name, file.size]));
    const contents = new Map(accepted.map((file) => [file.name, file.content]));
    const job = (0, importJob_service_1.createJob)(accepted.map((file) => file.name), sizes, contents);
    res.status(202).json({ success: true, jobId: job.id, total: accepted.length });
    void runJob(job.id, accepted);
});
/**
 * Runs a job: every file is processed with a bounded concurrency.
 *
 * @param jobId - Identifier of the job.
 * @param files - The files to process.
 */
async function runJob(jobId, files) {
    const job = (0, importJob_service_1.getJob)(jobId);
    if (!job) {
        return;
    }
    const byName = new Map(files.map((file) => [file.name, file.content]));
    const queue = [...job.files];
    const concurrency = Math.max(1, app_config_1.appConfig.maxConcurrency);
    const worker = async () => {
        while (queue.length > 0) {
            if ((0, importJob_service_1.isCancelled)(jobId)) {
                return;
            }
            const next = queue.shift();
            if (!next) {
                return;
            }
            const content = byName.get(next.fileName) ?? '';
            await (0, importJob_service_1.processFile)(jobId, next.id, content);
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const finished = (0, importJob_service_1.getJob)(jobId);
    if (finished) {
        (0, importJob_service_1.persistHistory)(finished);
    }
}
/**
 * Retries a single failed file.
 */
exports.importRouter.post('/jobs/:jobId/files/:fileId/retry', adminAuth_1.requireAdmin, async (req, res) => {
    const jobId = req.params['jobId'] ?? '';
    const fileId = req.params['fileId'] ?? '';
    const job = (0, importJob_service_1.getJob)(jobId);
    if (!job) {
        res.status(404).json({ success: false, message: 'Job not found' });
        return;
    }
    const file = job.files.find((entry) => entry.id === fileId);
    if (!file) {
        res.status(404).json({ success: false, message: 'File not found' });
        return;
    }
    const body = req.body;
    const content = typeof body.content === 'string' && body.content.trim().length > 0
        ? body.content
        : ((0, importJob_service_1.getFileContent)(jobId, file.fileName) ?? '');
    if (content.trim().length === 0) {
        res.status(400).json({
            success: false,
            message: 'The content of the file is required to retry it',
        });
        return;
    }
    (0, importJob_service_1.updateFile)(jobId, fileId, { status: importStatus_1.ImportStatus.WAITING, error: undefined });
    res.status(202).json({ success: true, message: 'The file is being retried' });
    void (0, importJob_service_1.processFile)(jobId, fileId, content);
});
/**
 * Imports a single reviewed movie into MongoDB.
 */
exports.importRouter.post('/jobs/:jobId/files/:fileId/import', adminAuth_1.requireAdmin, async (req, res) => {
    const jobId = req.params['jobId'] ?? '';
    const fileId = req.params['fileId'] ?? '';
    const body = req.body;
    const job = (0, importJob_service_1.getJob)(jobId);
    const file = job?.files.find((entry) => entry.id === fileId);
    if (!job || !file) {
        res.status(404).json({ success: false, message: 'File not found' });
        return;
    }
    const comparison = (0, importJob_service_1.getComparison)(jobId, fileId);
    const parsed = file.parsed;
    if (!comparison || !parsed?.mapped) {
        res.status(400).json({ success: false, message: 'The file was not parsed yet' });
        return;
    }
    if (comparison.matchStatus === importStatus_1.MatchStatus.AMBIGUOUS && !body.targetMovieId) {
        res.status(400).json({
            success: false,
            message: 'Several documents match this movie, the target document must be selected explicitly',
        });
        return;
    }
    const selectedFields = Array.isArray(body.selectedFields)
        ? body.selectedFields
        : comparison.updatableFields;
    const dryRun = body.dryRun !== false;
    // A brand new document must carry the fields required by the `Movie` schema,
    // otherwise the write would fail with an obscure validation error.
    if (!comparison.existing && selectedFields.length === 0) {
        res.status(400).json({
            success: false,
            message: 'No field was selected. A new document needs at least the "name" and "slug" fields.',
        });
        return;
    }
    (0, importJob_service_1.updateFile)(jobId, fileId, { status: importStatus_1.ImportStatus.PROCESSING, error: undefined });
    try {
        const existing = comparison.existing ??
            comparison.candidates.find((candidate) => candidate._id === body.targetMovieId);
        const outcome = await (0, movieImport_service_1.importMovie)(fileId, file.fileName, parsed.mapped, parsed.raw, existing, {
            selectedFields,
            dryRun,
            targetMovieId: body.targetMovieId,
        });
        const log = (0, movieImport_service_1.buildLogEntry)(fileId, file.fileName, parsed.mapped, outcome);
        (0, importJob_service_1.addLog)(jobId, log);
        if (outcome.error) {
            (0, importJob_service_1.updateFile)(jobId, fileId, { status: importStatus_1.ImportStatus.FAILED, error: outcome.error });
            res.status(500).json({ success: false, message: outcome.error, log });
            return;
        }
        (0, importJob_service_1.updateFile)(jobId, fileId, {
            status: importStatus_1.ImportStatus.SUCCESS,
            existingMovieId: outcome.movieId ?? file.existingMovieId,
        });
        res.json({ success: true, dryRun, log, outcome });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        (0, importJob_service_1.updateFile)(jobId, fileId, { status: importStatus_1.ImportStatus.FAILED, error: message });
        res.status(500).json({ success: false, message });
    }
});
/**
 * Returns the import history.
 */
exports.importRouter.get('/history', adminAuth_1.requireAdmin, (_req, res) => {
    res.json({ success: true, history: (0, importJob_service_1.readHistory)() });
});
/**
 * Streams the job updates over Server-Sent Events.
 */
exports.importRouter.get('/jobs/:jobId/stream', adminAuth_1.requireAdmin, (req, res) => {
    const jobId = req.params['jobId'] ?? '';
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    const job = (0, importJob_service_1.getJob)(jobId);
    if (job) {
        res.write(`event: job:updated\ndata: ${JSON.stringify({ type: 'job:updated', job })}\n\n`);
    }
    const listener = (event) => {
        const typed = event;
        if (typed.jobId && typed.jobId !== jobId) {
            return;
        }
        res.write(`event: ${typed.type ?? 'message'}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    importJob_service_1.jobEvents.on('event', listener);
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);
    req.on('close', () => {
        clearInterval(heartbeat);
        importJob_service_1.jobEvents.off('event', listener);
        res.end();
    });
});
/**
 * Lists the fields that can be updated for a given comparison.
 */
exports.importRouter.get('/fields', adminAuth_1.requireAdmin, (_req, res) => {
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
        fieldStatuses: Object.values(importStatus_1.FieldStatus),
    });
});
//# sourceMappingURL=import.routes.js.map