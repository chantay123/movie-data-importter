import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Bridge towards the MongoDB layer of the crawler project.
 *
 * The `Movie` schema is NOT redefined here: the importer loads the very same
 * model files (and the very same `mongoose` instance) that the crawler uses,
 * so both applications write to an identical collection with an identical
 * schema and share a single connection pool.
 */

const requireModule = createRequire(__filename);

/**
 * Minimal contract of the mongoose instance used by the importer.
 */
export interface MongooseLike {
  /** Registers the models of the crawler project. */
  models: Record<string, unknown>;
  /** Connection object of the instance. */
  connection: {
    /** Current state of the connection. */
    readyState: number;
    /** Name of the connected database. */
    name?: string;
    /** Host of the connected server. */
    host?: string;
  };
  /** Opens the connection. */
  connect(uri: string, options?: Record<string, unknown>): Promise<unknown>;
  /** Closes the connection. */
  disconnect(): Promise<void>;
  /** Enables or disables the command buffering. */
  set(key: string, value: unknown): unknown;
}

/**
 * Minimal contract of a mongoose model used by the importer.
 */
export interface ModelLike {
  /** Runs a find query and returns the lean documents. */
  find(filter: unknown, projection?: unknown): { limit(count: number): { lean(): Promise<unknown[]> } };
  /** Finds a single document by identifier. */
  findById(id: string): { lean(): Promise<unknown> };
  /** Finds a single document matching the filter. */
  findOne(filter: unknown): { lean(): Promise<unknown> };
  /** Creates a new document. */
  create(document: unknown): Promise<{ _id: unknown }>;
  /** Updates a single document and returns it. */
  findOneAndUpdate(
    filter: unknown,
    update: unknown,
    options?: unknown,
  ): Promise<unknown>;
}

/**
 * The models exported by the crawler project.
 */
export interface CrawlerModels {
  /** The `Movie` model. */
  Movie: ModelLike;
  /** The `Category` master data model. */
  Category: { findOrCreate(data: unknown): Promise<{ _id?: unknown } | null> };
  /** The `Country` master data model. */
  Country: { findOrCreate(data: unknown): Promise<{ _id?: unknown } | null> };
  /** The `Actor` master data model. */
  Actor: { findOrCreate(name: string): Promise<{ _id?: unknown } | null> };
  /** The `Director` master data model. */
  Director: { findOrCreate(name: string): Promise<{ _id?: unknown } | null> };
  /** The `Format` master data model (quality of a movie). */
  Format: { findOrCreate(data: unknown): Promise<{ _id?: unknown } | null> };
  /** The `Year` master data model. */
  Year: { findOrCreate(year: number | string): Promise<{ _id?: unknown } | null> };
  /** The `MovieCategory` junction model. */
  MovieCategory: { setCategories(movieId: string, ids: unknown[]): Promise<unknown> };
  /** The `MovieCountry` junction model. */
  MovieCountry: { setCountries(movieId: string, ids: unknown[]): Promise<unknown> };
  /** The `MovieActor` junction model. */
  MovieActor: { setActors(movieId: string, actors: unknown[]): Promise<unknown> };
  /** The `MovieDirector` junction model. */
  MovieDirector: { setDirectors(movieId: string, directors: unknown[]): Promise<unknown> };
  /** The `MovieFormat` junction model. */
  MovieFormat: { setFormats(movieId: string, ids: unknown[]): Promise<unknown> };
  /** The `MovieYear` junction model. */
  MovieYear: { setYear(movieId: string, id: unknown): Promise<unknown> };
}

/**
 * Absolute path of the crawler project, resolved from the environment.
 */
let crawlerRoot: string | null = null;

/**
 * The `mongoose` instance owned by the crawler project.
 */
let mongooseInstance: MongooseLike | null = null;

/**
 * The models exported by the crawler project.
 */
let crawlerModels: CrawlerModels | null = null;

/**
 * Locates the crawler project directory.
 *
 * The lookup order is:
 *   1. the `CRAWLER_PROJECT_PATH` environment variable,
 *   2. the sibling `crawl-data-movie` folder of the workspace.
 *
 * @returns The absolute path of the crawler project or `null` when it cannot be found.
 */
function findCrawlerRoot(): string | null {
  const candidates: string[] = [];

  const fromEnv = process.env['CRAWLER_PROJECT_PATH'];
  if (fromEnv) {
    candidates.push(path.resolve(fromEnv));
  }

  // <workspace>/Movie-Data-Importer/backend/src/database -> <workspace>
  candidates.push(path.resolve(__dirname, '..', '..', '..', '..', 'crawl-data-movie'));
  candidates.push(path.resolve(process.cwd(), '..', 'crawl-data-movie'));
  candidates.push(path.resolve(process.cwd(), 'crawl-data-movie'));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'src', 'models', 'Movie.js'))) {
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
function loadCrawlerModels(): void {
  if (crawlerModels && mongooseInstance) {
    return;
  }

  crawlerRoot = findCrawlerRoot();

  if (!crawlerRoot) {
    throw new Error(
      'Unable to locate the crawler project. Set CRAWLER_PROJECT_PATH to the folder ' +
        'containing "src/models/Movie.js" so the importer can reuse the existing Movie schema.',
    );
  }

  mongooseInstance = requireModule(
    path.join(crawlerRoot, 'node_modules', 'mongoose'),
  ) as MongooseLike;
  crawlerModels = requireModule(
    path.join(crawlerRoot, 'src', 'models', 'index.js'),
  ) as CrawlerModels;
}

/**
 * Returns the mongoose instance shared with the crawler project.
 *
 * @returns The mongoose instance.
 */
export function getMongoose(): MongooseLike {
  loadCrawlerModels();
  return mongooseInstance as MongooseLike;
}

/**
 * Returns the `Movie` model of the crawler project.
 *
 * @returns The Movie mongoose model.
 */
export function getMovieModel(): ModelLike {
  loadCrawlerModels();
  return (crawlerModels as CrawlerModels).Movie;
}

/**
 * Returns every model of the crawler project.
 *
 * @returns The models indexed by name.
 */
export function getModels(): CrawlerModels {
  loadCrawlerModels();
  return crawlerModels as CrawlerModels;
}

/**
 * Path of the crawler project currently in use.
 *
 * @returns The absolute path, or `null` when the models were not loaded yet.
 */
export function getCrawlerProjectPath(): string | null {
  return crawlerRoot;
}
