import type { ImportJob, MovieComparison } from '../types/api.types';

/**
 * HTTP client of the importer API.
 *
 * The panel never talks to MongoDB directly: every write goes through the
 * importer backend, which owns the database credentials.
 */

/**
 * Base URL of the importer API.
 *
 * The variable is read from the environment of the panel. When it is missing
 * or empty, the Vite proxy is used: the panel and the API then share the same
 * origin and no CORS configuration is needed.
 */
const API_BASE_URL: string =
  import.meta.env['VITE_IMPORTER_API_URL']?.trim() || '/api/import';

/**
 * Admin credential sent with every request.
 *
 * The value is read from the environment of the panel and is never stored in
 * the source code.
 */
const API_KEY: string = import.meta.env['VITE_IMPORTER_API_KEY']?.trim() ?? '';

/**
 * A file selected by the user, ready to be uploaded.
 */
export interface SelectedFile {
  /** Name of the file. */
  name: string;
  /** Size of the file in bytes. */
  size: number;
  /** Raw content of the file. */
  content: string;
}

/**
 * Builds the headers of a request.
 *
 * @returns The HTTP headers.
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY.length > 0) {
    headers['x-import-api-key'] = API_KEY;
  }

  const token =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('auth_token') ?? localStorage.getItem('token')
      : null;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Executes a request against the importer API.
 *
 * @param path - Path of the endpoint, relative to the API base URL.
 * @param init - Options of the request.
 * @returns The parsed response body.
 * @throws {Error} When the API answers with an error status.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...buildHeaders(), ...(init.headers ?? {}) },
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { success?: boolean; message?: string })
    | null;

  if (!response.ok) {
    const message = payload?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

/**
 * Creates an import job from the selected files.
 *
 * @param files - The files to import.
 * @returns The identifier of the created job.
 */
export async function createImportJob(files: SelectedFile[]): Promise<string> {
  const response = await request<{ jobId: string }>('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        content: file.content,
      })),
    }),
  });

  return response.jobId;
}

/**
 * Returns the state of a job together with its comparisons.
 *
 * @param jobId - Identifier of the job.
 * @returns The job and its comparisons.
 */
export async function fetchJob(
  jobId: string,
): Promise<{ job: ImportJob; comparisons: MovieComparison[] }> {
  return request(`/jobs/${jobId}`);
}

/**
 * Cancels a running job.
 *
 * @param jobId - Identifier of the job.
 * @returns A promise resolved once the job is cancelled.
 */
export async function cancelImportJob(jobId: string): Promise<void> {
  await request(`/jobs/${jobId}/cancel`, { method: 'POST' });
}

/**
 * Retries a single failed file.
 *
 * The backend keeps the uploaded content, so the retry does not have to send
 * the file again.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @returns A promise resolved once the retry is triggered.
 */
export async function retryFile(jobId: string, fileId: string): Promise<void> {
  await request(`/jobs/${jobId}/files/${fileId}/retry`, { method: 'POST' });
}

/**
 * Imports a single reviewed movie into MongoDB.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @param selectedFields - Fields the user selected.
 * @param dryRun - Whether the write must be skipped.
 * @param targetMovieId - Document chosen by the user for an ambiguous match.
 * @returns The result of the import.
 */
export async function importFile(
  jobId: string,
  fileId: string,
  selectedFields: string[],
  dryRun: boolean,
  targetMovieId?: string,
): Promise<{ success: boolean; message?: string; dryRun?: boolean }> {
  return request(`/jobs/${jobId}/files/${fileId}/import`, {
    method: 'POST',
    body: JSON.stringify({ selectedFields, dryRun, targetMovieId }),
  });
}

/**
 * Returns the parsed JSON of a file.
 *
 * @param jobId - Identifier of the job.
 * @param fileId - Identifier of the file.
 * @returns The parsed, extracted and mapped payloads.
 */
export async function fetchFileJson(
  jobId: string,
  fileId: string,
): Promise<{
  raw: unknown;
  extracted: unknown;
  mapped: unknown;
  issues: unknown[];
  sourceFormat?: string;
  unmappedFields?: string[];
}> {
  return request(`/jobs/${jobId}/files/${fileId}/json`);
}

/**
 * Returns the JSON of every parsed file of a job.
 *
 * @param jobId - Identifier of the job.
 * @param mode - `raw`, `extracted` or `mapped`.
 * @returns The exported movies.
 */
export async function exportJob(
  jobId: string,
  mode: 'raw' | 'extracted' | 'mapped',
): Promise<{ movies: Array<{ fileName: string; data: unknown }> }> {
  return request(`/jobs/${jobId}/export?mode=${mode}`);
}

/**
 * Returns the import history.
 *
 * @returns The persisted runs.
 */
export async function fetchHistory(): Promise<{ history: Array<Record<string, unknown>> }> {
  return request('/history');
}

/**
 * Returns the health of the importer and of the database connection.
 *
 * @returns The health payload.
 */
export async function fetchHealth(): Promise<{
  database: { connected: boolean; database: string; configured: boolean };
  limits: { maxConcurrency: number; maxFileSize: number };
}> {
  return request('/health');
}

/**
 * Builds the URL of the SSE stream of a job.
 *
 * @param jobId - Identifier of the job.
 * @returns The absolute URL of the stream.
 */
export function buildStreamUrl(jobId: string): string {
  const base = API_BASE_URL.startsWith('http') ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
  const separator = base.includes('?') ? '&' : '?';

  return `${base}/jobs/${jobId}/stream${separator}apiKey=${encodeURIComponent(API_KEY)}`;
}
