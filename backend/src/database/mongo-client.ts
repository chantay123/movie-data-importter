import { appConfig, hasDatabaseConfig } from '../config/app.config';
import { getMongoose, getCrawlerProjectPath } from './crawlerModels';

/**
 * MongoDB connection manager.
 *
 * The connection is established through the `mongoose` instance of the
 * crawler project so the importer and the crawler share a single pool and a
 * single set of registered models.
 */

let connectionPromise: Promise<void> | null = null;

/**
 * Opens the MongoDB connection.
 *
 * @returns A promise resolved once the connection is ready.
 */
export async function connectDatabase(): Promise<void> {
  if (connectionPromise) {
    return connectionPromise;
  }

  if (!hasDatabaseConfig()) {
    throw new Error(
      'MONGODB_URI and MONGODB_NAME are required. Add them to the .env file of the importer ' +
        'or of the crawler project.',
    );
  }

  const mongoose = getMongoose();

  connectionPromise = (async (): Promise<void> => {
    mongoose.set('bufferCommands', false);

    await mongoose.connect(appConfig.mongodbUri, {
      dbName: appConfig.mongodbName,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 1,
    });

    if (mongoose.connection.readyState !== 1) {
      throw new Error(`MongoDB is not ready (readyState=${mongoose.connection.readyState}).`);
    }
  })();

  try {
    await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }
}

/**
 * Closes the MongoDB connection.
 *
 * @returns A promise resolved once the connection is closed.
 */
export async function disconnectDatabase(): Promise<void> {
  const mongoose = getMongoose();
  connectionPromise = null;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/**
 * Describes the current state of the database connection.
 *
 * @returns The connection status, safe to expose to the admin panel.
 */
export function getDatabaseStatus(): {
  connected: boolean;
  database: string;
  readyState: number;
  crawlerProject: string | null;
} {
  const mongoose = getMongoose();

  return {
    connected: mongoose.connection.readyState === 1,
    database: mongoose.connection.name ?? appConfig.mongodbName,
    readyState: mongoose.connection.readyState,
    crawlerProject: getCrawlerProjectPath(),
  };
}

/**
 * Checks whether MongoDB is reachable before a query is issued.
 *
 * The importer never queues a query when the connection is down: it reports a
 * clear error instead of an obscure mongoose failure.
 *
 * @returns `true` when the connection is established.
 */
export function isDatabaseReady(): boolean {
  return getMongoose().connection.readyState === 1;
}
