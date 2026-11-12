"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = connectDatabase;
exports.disconnectDatabase = disconnectDatabase;
exports.getDatabaseStatus = getDatabaseStatus;
exports.isDatabaseReady = isDatabaseReady;
const app_config_1 = require("../config/app.config");
const crawlerModels_1 = require("./crawlerModels");
/**
 * MongoDB connection manager.
 *
 * The connection is established through the `mongoose` instance of the
 * crawler project so the importer and the crawler share a single pool and a
 * single set of registered models.
 */
let connectionPromise = null;
/**
 * Opens the MongoDB connection.
 *
 * @returns A promise resolved once the connection is ready.
 */
async function connectDatabase() {
    if (connectionPromise) {
        return connectionPromise;
    }
    if (!(0, app_config_1.hasDatabaseConfig)()) {
        throw new Error('MONGODB_URI and MONGODB_NAME are required. Add them to the .env file of the importer ' +
            'or of the crawler project.');
    }
    const mongoose = (0, crawlerModels_1.getMongoose)();
    connectionPromise = (async () => {
        mongoose.set('bufferCommands', false);
        await mongoose.connect(app_config_1.appConfig.mongodbUri, {
            dbName: app_config_1.appConfig.mongodbName,
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
    }
    catch (error) {
        connectionPromise = null;
        throw error;
    }
}
/**
 * Closes the MongoDB connection.
 *
 * @returns A promise resolved once the connection is closed.
 */
async function disconnectDatabase() {
    const mongoose = (0, crawlerModels_1.getMongoose)();
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
function getDatabaseStatus() {
    const mongoose = (0, crawlerModels_1.getMongoose)();
    return {
        connected: mongoose.connection.readyState === 1,
        database: mongoose.connection.name ?? app_config_1.appConfig.mongodbName,
        readyState: mongoose.connection.readyState,
        crawlerProject: (0, crawlerModels_1.getCrawlerProjectPath)(),
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
function isDatabaseReady() {
    return (0, crawlerModels_1.getMongoose)().connection.readyState === 1;
}
//# sourceMappingURL=mongo-client.js.map