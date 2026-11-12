import cors from 'cors';
import express, { type Express } from 'express';
import { appConfig } from '../config/app.config';
import { getDatabaseStatus } from '../database/mongo-client';
import { importRouter } from '../routes/import.routes';

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
export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: appConfig.corsOrigins.length > 0 ? appConfig.corsOrigins : true,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '64mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      service: 'movie-data-importer',
      database: getDatabaseStatus(),
    });
  });

  app.use('/api/import', importRouter);

  app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
  });

  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[import] Unhandled error: ${message}`);
      res.status(500).json({ success: false, message });
    },
  );

  return app;
}