"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobEvents = void 0;
exports.recountJob = recountJob;
exports.updateFile = updateFile;
exports.createJob = createJob;
exports.getJob = getJob;
exports.getComparison = getComparison;
exports.getComparisons = getComparisons;
exports.getFileContent = getFileContent;
exports.setComparison = setComparison;
exports.addLog = addLog;
exports.cancelJob = cancelJob;
exports.isCancelled = isCancelled;
exports.processFile = processFile;
exports.listJobs = listJobs;
exports.persistHistory = persistHistory;
exports.readHistory = readHistory;
const node_events_1 = require("node:events");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const app_config_1 = require("../config/app.config");
const importStatus_1 = require("../constants/importStatus");
const movieDiff_service_1 = require("./movieDiff.service");
const movieMatcher_service_1 = require("./movieMatcher.service");
const textParser_service_1 = require("./textParser.service");
/**
 * In-memory registry of the import jobs.
 */
const jobs = new Map();
/**
 * Event bus used to broadcast the job updates to the SSE endpoints.
 */
exports.jobEvents = new node_events_1.EventEmitter();
exports.jobEvents.setMaxListeners(0);
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
function recountJob(job) {
    const files = Array.isArray(job?.files) ? job.files : [];
    const logs = Array.isArray(job?.logs) ? job.logs : [];
    const counters = {
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
        if (file.status === importStatus_1.ImportStatus.SUCCESS) {
            counters.success += 1;
            counters.processed += 1;
        }
        else if (file.status === importStatus_1.ImportStatus.FAILED) {
            counters.failed += 1;
            counters.processed += 1;
        }
        else if (file.status === importStatus_1.ImportStatus.NEEDS_REVIEW) {
            counters.needsReview += 1;
            counters.processed += 1;
        }
        else if (file.status === importStatus_1.ImportStatus.SKIPPED) {
            counters.skipped += 1;
            counters.processed += 1;
        }
        else if (file.status === importStatus_1.ImportStatus.CANCELLED) {
            counters.cancelled += 1;
            counters.processed += 1;
        }
        else if (file.status === importStatus_1.ImportStatus.PROCESSING) {
            counters.processing += 1;
        }
    }
    counters.imported = logs.filter((log) => log.status === importStatus_1.ImportStatus.SUCCESS).length;
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
function emit(event) {
    exports.jobEvents.emit('event', event);
}
/**
 * Updates the state of a file and broadcasts the change.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @param patch - The fields to update.
 * @returns The updated file progress.
 */
function updateFile(jobId, fileId, patch) {
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
function createJob(fileNames, fileSizes, contents) {
    const id = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const files = fileNames.map((fileName) => ({
        id: `file_${++fileSequence}`,
        fileName,
        fileSize: fileSizes.get(fileName) ?? 0,
        status: importStatus_1.ImportStatus.WAITING,
        stage: importStatus_1.ProcessingStage.READING,
        progress: 0,
        readableFieldCount: 0,
        episodeCount: 0,
    }));
    const job = {
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
function getJob(jobId) {
    return jobs.get(jobId)?.job;
}
/**
 * Returns the comparison of a file.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @returns The comparison or `undefined`.
 */
function getComparison(jobId, fileId) {
    return jobs.get(jobId)?.comparisons.get(fileId);
}
/**
 * Returns every comparison of a job.
 *
 * @param jobId - Identifier of the job.
 * @returns The list of comparisons.
 */
function getComparisons(jobId) {
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
function getFileContent(jobId, fileName) {
    return jobs.get(jobId)?.contents.get(fileName);
}
/**
 * Stores the comparison of a file.
 *
 * @param jobId - Identifier of the job.
 * @param comparison - The comparison to store.
 */
function setComparison(jobId, comparison) {
    jobs.get(jobId)?.comparisons.set(comparison.fileId, comparison);
}
/**
 * Adds a log entry to a job.
 *
 * @param jobId - Identifier of the job.
 * @param log - The log entry.
 */
function addLog(jobId, log) {
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
function cancelJob(jobId) {
    const state = jobs.get(jobId);
    if (!state) {
        return false;
    }
    state.cancelled = true;
    state.job.cancelled = true;
    state.job.updatedAt = new Date().toISOString();
    for (const file of state.job.files) {
        if (file.status === importStatus_1.ImportStatus.WAITING || file.status === importStatus_1.ImportStatus.PROCESSING) {
            file.status = importStatus_1.ImportStatus.CANCELLED;
            file.stage = importStatus_1.ProcessingStage.COMPLETED;
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
function isCancelled(jobId) {
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
async function processFile(jobId, fileId, content) {
    const state = jobs.get(jobId);
    const file = state?.job.files.find((entry) => entry.id === fileId);
    if (!state || !file) {
        return undefined;
    }
    updateFile(jobId, fileId, {
        status: importStatus_1.ImportStatus.PROCESSING,
        stage: importStatus_1.ProcessingStage.READING,
        progress: 10,
        startedAt: new Date().toISOString(),
    });
    try {
        const parsed = (0, textParser_service_1.parseMovieFile)(file.fileName, file.fileSize, content);
        updateFile(jobId, fileId, {
            stage: importStatus_1.ProcessingStage.EXTRACTING,
            progress: 30,
            detectedName: parsed.detectedName,
            readableFieldCount: parsed.readableFieldCount,
            episodeCount: parsed.episodeCount,
            serverCount: parsed.serverCount,
            sourceFormat: parsed.sourceFormat,
            parsed,
        });
        if (!parsed.raw || !parsed.mapped) {
            updateFile(jobId, fileId, {
                status: importStatus_1.ImportStatus.FAILED,
                stage: importStatus_1.ProcessingStage.COMPLETED,
                progress: 100,
                error: parsed.issues.find((issue) => issue.severity === 'error')?.message ?? 'Parsing failed',
                finishedAt: new Date().toISOString(),
            });
            return getJob(jobId)?.files.find((entry) => entry.id === fileId);
        }
        updateFile(jobId, fileId, { stage: importStatus_1.ProcessingStage.VALIDATING, progress: 50 });
        updateFile(jobId, fileId, { stage: importStatus_1.ProcessingStage.MAPPING, progress: 60 });
        updateFile(jobId, fileId, { stage: importStatus_1.ProcessingStage.COMPARING_DATABASE, progress: 75 });
        const match = await (0, movieMatcher_service_1.findMatchingMovie)(parsed.mapped);
        const comparison = (0, movieDiff_service_1.buildComparison)(fileId, parsed.mapped, match);
        state.comparisons.set(fileId, comparison);
        const isAmbiguous = match.status === importStatus_1.MatchStatus.AMBIGUOUS;
        const hasBlockingError = parsed.issues.some((issue) => issue.severity === 'error');
        updateFile(jobId, fileId, {
            stage: importStatus_1.ProcessingStage.COMPLETED,
            progress: 100,
            matchStatus: match.status,
            existingMovieId: match.movie?._id,
            status: hasBlockingError
                ? importStatus_1.ImportStatus.FAILED
                : isAmbiguous
                    ? importStatus_1.ImportStatus.NEEDS_REVIEW
                    : importStatus_1.ImportStatus.SUCCESS,
            error: hasBlockingError
                ? parsed.issues.find((issue) => issue.severity === 'error')?.message
                : undefined,
            finishedAt: new Date().toISOString(),
        });
        return getJob(jobId)?.files.find((entry) => entry.id === fileId);
    }
    catch (error) {
        updateFile(jobId, fileId, {
            status: importStatus_1.ImportStatus.FAILED,
            stage: importStatus_1.ProcessingStage.COMPLETED,
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
function listJobs() {
    return [...jobs.values()]
        .map((state) => state.job)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
/**
 * Persists the import history on disk so it survives a server restart.
 *
 * @param job - The job to persist.
 */
function persistHistory(job) {
    try {
        node_fs_1.default.mkdirSync(app_config_1.appConfig.historyDir, { recursive: true });
        const filePath = node_path_1.default.join(app_config_1.appConfig.historyDir, `${job.id}.json`);
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
        node_fs_1.default.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    }
    catch (error) {
        console.warn(`[import] Unable to persist the import history: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Reads the import history persisted on disk.
 *
 * @returns The list of persisted runs, most recent first.
 */
function readHistory() {
    try {
        if (!node_fs_1.default.existsSync(app_config_1.appConfig.historyDir)) {
            return [];
        }
        return node_fs_1.default
            .readdirSync(app_config_1.appConfig.historyDir)
            .filter((fileName) => fileName.endsWith('.json'))
            .map((fileName) => {
            const raw = node_fs_1.default.readFileSync(node_path_1.default.join(app_config_1.appConfig.historyDir, fileName), 'utf8');
            return JSON.parse(raw);
        })
            .sort((left, right) => String(right['createdAt']).localeCompare(String(left['createdAt'])));
    }
    catch (error) {
        console.warn(`[import] Unable to read the import history: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}
//# sourceMappingURL=importJob.service.js.map