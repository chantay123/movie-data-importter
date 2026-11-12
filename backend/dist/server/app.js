"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const app_config_1 = require("../config/app.config");
const mongo_client_1 = require("../database/mongo-client");
const import_routes_1 = require("../routes/import.routes");
/**
 * Express application of the importer.
 *
 * The application only proxies the writes to MongoDB: the connection string
 * and the credentials never leave the backend.
 */
/**
 * Builds the Express application.
 *
 * @returns The configured application.
 */
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({
        origin: app_config_1.appConfig.corsOrigins.length > 0 ? app_config_1.appConfig.corsOrigins : true,
        credentials: true,
    }));
    app.use(express_1.default.json({ limit: '64mb' }));
    app.get('/health', (_req, res) => {
        res.json({
            success: true,
            service: 'movie-data-importer',
            database: (0, mongo_client_1.getDatabaseStatus)(),
        });
    });
    app.use('/api/import', import_routes_1.importRouter);
    app.use((_req, res) => {
        res.status(404).json({ success: false, message: 'Route not found' });
    });
    app.use((error, _req, res, _next) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[import] Unhandled error: ${message}`);
        res.status(500).json({ success: false, message });
    });
    return app;
}
//# sourceMappingURL=app.js.map