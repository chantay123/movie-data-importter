import { config as loadDotEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Configuration of the importer.
 *
 * Every value comes from the environment: no connection string, credential or
 * secret is ever hardcoded in the source code.
 */

loadDotEnv({ path: path.resolve(process.cwd(), '.env'), override: false });
loadDotEnv({ path: path.resolve(process.cwd(), '..', '.env'), override: false });

/**
 * Reads a numeric environment variable.
 *
 * @param name - Name of the variable.
 * @param fallback - Value used when the variable is missing or invalid.
 * @returns The parsed number.
 */
function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads a string environment variable.
 *
 * @param name - Name of the variable.
 * @param fallback - Value used when the variable is missing.
 * @returns The value.
 */
function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Loads the `.env` file of the crawler project when it exists.
 *
 * The importer reuses the very same MongoDB credentials as the crawler so
 * that both applications always target the same database.
 */
function loadCrawlerEnv(): void {
  const crawlerRoot = readString('CRAWLER_PROJECT_PATH', '');
  const roots = [
    crawlerRoot,
    path.resolve(process.cwd(), '..', 'crawl-data-movie'),
    path.resolve(__dirname, '..', '..', '..', '..', 'crawl-data-movie'),
  ].filter(Boolean);

  for (const root of roots) {
    const envFile = path.join(root, '.env');
    if (fs.existsSync(envFile)) {
      loadDotEnv({ path: envFile, override: false });
      return;
    }
  }
}

loadCrawlerEnv();

/**
 * Effective configuration of the importer.
 */
export const appConfig = {
  /** Port the API listens on. */
  port: readNumber('IMPORT_API_PORT', 4100),
  /** MongoDB connection string. */
  mongodbUri: readString('MONGODB_URI', ''),
  /** MongoDB database name. */
  mongodbName: readString('MONGODB_NAME', ''),
  /** Maximum number of files processed concurrently. */
  maxConcurrency: readNumber('IMPORT_MAX_CONCURRENCY', 3),
  /** Maximum size accepted for a single TXT file, in bytes. */
  maxFileSize: readNumber('IMPORT_MAX_FILE_SIZE', 10 * 1024 * 1024),
  /** Comma separated list of origins allowed to call the API. */
  corsOrigins: readString('IMPORT_CORS_ORIGINS', 'http://localhost:3000,http://localhost:5000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /**
   * Shared secret used by the admin panel to call the API.
   * When empty, the API still requires a valid admin JWT.
   */
  adminApiKey: readString('IMPORT_ADMIN_API_KEY', ''),
  /** Path of the folder where the import history is persisted. */
  historyDir: readString('IMPORT_HISTORY_DIR', path.resolve(process.cwd(), 'data', 'history')),
} as const;

/**
 * Checks whether the configuration is complete enough to reach MongoDB.
 *
 * @returns `true` when a connection string and a database name are available.
 */
export function hasDatabaseConfig(): boolean {
  return appConfig.mongodbUri.length > 0 && appConfig.mongodbName.length > 0;
}
