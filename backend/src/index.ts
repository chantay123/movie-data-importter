import { appConfig } from './config/app.config';
import { connectDatabase, disconnectDatabase } from './database/mongo-client';
import { createApp } from './server/app';

/**
 * Entry point of the importer API.
 */
async function main(): Promise<void> {
  const app = createApp();

  try {
    await connectDatabase();
    console.log('[import] MongoDB connection is ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[import] MongoDB connection failed: ${message}`);
    console.error('[import] The API starts anyway, the import endpoints will report the failure.');
  }

  const server = app.listen(appConfig.port, () => {
    console.log(`[import] API listening on http://localhost:${appConfig.port}`);
    console.log(`[import] Health check: http://localhost:${appConfig.port}/health`);
  });

  const shutdown = async (): Promise<void> => {
    console.log('[import] Shutting down...');
    server.close();
    await disconnectDatabase();
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
