"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appConfig = void 0;
exports.hasDatabaseConfig = hasDatabaseConfig;
const dotenv_1 = require("dotenv");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
/**
 * Configuration of the importer.
 *
 * Every value comes from the environment: no connection string, credential or
 * secret is ever hardcoded in the source code.
 */
(0, dotenv_1.config)({ path: node_path_1.default.resolve(process.cwd(), '.env'), override: false });
(0, dotenv_1.config)({ path: node_path_1.default.resolve(process.cwd(), '..', '.env'), override: false });
/**
 * Reads a numeric environment variable.
 *
 * @param name - Name of the variable.
 * @param fallback - Value used when the variable is missing or invalid.
 * @returns The parsed number.
 */
function readNumber(name, fallback) {
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
function readString(name, fallback) {
    const raw = process.env[name];
    return raw === undefined || raw === '' ? fallback : raw;
}
/**
 * Loads the `.env` file of the crawler project when it exists.
 *
 * The importer reuses the very same MongoDB credentials as the crawler so
 * that both applications always target the same database.
 */
function loadCrawlerEnv() {
    const crawlerRoot = readString('CRAWLER_PROJECT_PATH', '');
    const roots = [
        crawlerRoot,
        node_path_1.default.resolve(process.cwd(), '..', 'crawl-data-movie'),
        node_path_1.default.resolve(__dirname, '..', '..', '..', '..', 'crawl-data-movie'),
    ].filter(Boolean);
    for (const root of roots) {
        const envFile = node_path_1.default.join(root, '.env');
        if (node_fs_1.default.existsSync(envFile)) {
            (0, dotenv_1.config)({ path: envFile, override: false });
            return;
        }
    }
}
loadCrawlerEnv();
/**
 * Effective configuration of the importer.
 */
exports.appConfig = {
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
    historyDir: readString('IMPORT_HISTORY_DIR', node_path_1.default.resolve(process.cwd(), 'data', 'history')),
};
/**
 * Checks whether the configuration is complete enough to reach MongoDB.
 *
 * @returns `true` when a connection string and a database name are available.
 */
function hasDatabaseConfig() {
    return exports.appConfig.mongodbUri.length > 0 && exports.appConfig.mongodbName.length > 0;
}
//# sourceMappingURL=app.config.js.map