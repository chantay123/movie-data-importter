"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMongoose = getMongoose;
exports.getMovieModel = getMovieModel;
exports.getModels = getModels;
exports.getCrawlerProjectPath = getCrawlerProjectPath;
const node_module_1 = require("node:module");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Bridge towards the MongoDB layer of the crawler project.
 *
 * The `Movie` schema is NOT redefined here: the importer loads the very same
 * model files (and the very same `mongoose` instance) that the crawler uses,
 * so both applications write to an identical collection with an identical
 * schema and share a single connection pool.
 */
const requireModule = (0, node_module_1.createRequire)(__filename);
/**
 * Absolute path of the crawler project, resolved from the environment.
 */
let crawlerRoot = null;
/**
 * The `mongoose` instance owned by the crawler project.
 */
let mongooseInstance = null;
/**
 * The models exported by the crawler project.
 */
let crawlerModels = null;
/**
 * Locates the crawler project directory.
 *
 * The lookup order is:
 *   1. the `CRAWLER_PROJECT_PATH` environment variable,
 *   2. the sibling `crawl-data-movie` folder of the workspace.
 *
 * @returns The absolute path of the crawler project or `null` when it cannot be found.
 */
function findCrawlerRoot() {
    const candidates = [];
    const fromEnv = process.env['CRAWLER_PROJECT_PATH'];
    if (fromEnv) {
        candidates.push(node_path_1.default.resolve(fromEnv));
    }
    // <workspace>/Movie-Data-Importer/backend/src/database -> <workspace>
    candidates.push(node_path_1.default.resolve(__dirname, '..', '..', '..', '..', 'crawl-data-movie'));
    candidates.push(node_path_1.default.resolve(process.cwd(), '..', 'crawl-data-movie'));
    candidates.push(node_path_1.default.resolve(process.cwd(), 'crawl-data-movie'));
    for (const candidate of candidates) {
        if (node_fs_1.default.existsSync(node_path_1.default.join(candidate, 'src', 'models', 'Movie.js'))) {
            return candidate;
        }
    }
    return null;
}
/**
 * Loads the crawler models and the mongoose instance they are bound to.
 *
 * @throws {Error} When the crawler project cannot be located.
 */
function loadCrawlerModels() {
    if (crawlerModels && mongooseInstance) {
        return;
    }
    crawlerRoot = findCrawlerRoot();
    if (!crawlerRoot) {
        throw new Error('Unable to locate the crawler project. Set CRAWLER_PROJECT_PATH to the folder ' +
            'containing "src/models/Movie.js" so the importer can reuse the existing Movie schema.');
    }
    mongooseInstance = requireModule(node_path_1.default.join(crawlerRoot, 'node_modules', 'mongoose'));
    crawlerModels = requireModule(node_path_1.default.join(crawlerRoot, 'src', 'models', 'index.js'));
}
/**
 * Returns the mongoose instance shared with the crawler project.
 *
 * @returns The mongoose instance.
 */
function getMongoose() {
    loadCrawlerModels();
    return mongooseInstance;
}
/**
 * Returns the `Movie` model of the crawler project.
 *
 * @returns The Movie mongoose model.
 */
function getMovieModel() {
    loadCrawlerModels();
    return crawlerModels.Movie;
}
/**
 * Returns every model of the crawler project.
 *
 * @returns The models indexed by name.
 */
function getModels() {
    loadCrawlerModels();
    return crawlerModels;
}
/**
 * Path of the crawler project currently in use.
 *
 * @returns The absolute path, or `null` when the models were not loaded yet.
 */
function getCrawlerProjectPath() {
    return crawlerRoot;
}
//# sourceMappingURL=crawlerModels.js.map