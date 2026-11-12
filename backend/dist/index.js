"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_config_1 = require("./config/app.config");
const mongo_client_1 = require("./database/mongo-client");
const app_1 = require("./server/app");
/**
 * Entry point of the importer API.
 */
async function main() {
    const app = (0, app_1.createApp)();
    try {
        await (0, mongo_client_1.connectDatabase)();
        console.log('[import] MongoDB connection is ready');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[import] MongoDB connection failed: ${message}`);
        console.error('[import] The API starts anyway, the import endpoints will report the failure.');
    }
    const server = app.listen(app_config_1.appConfig.port, () => {
        console.log(`[import] API listening on http://localhost:${app_config_1.appConfig.port}`);
        console.log(`[import] Health check: http://localhost:${app_config_1.appConfig.port}/health`);
    });
    const shutdown = async () => {
        console.log('[import] Shutting down...');
        server.close();
        await (0, mongo_client_1.disconnectDatabase)();
        process.exit(0);
    };
    process.on('SIGINT', () => {
        void shutdown();
    });
    process.on('SIGTERM', () => {
        void shutdown();
    });
}
void main();
//# sourceMappingURL=index.js.map