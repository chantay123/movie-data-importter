import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration of the admin panel.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_IMPORTER_API_URL || 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_IMPORTER_API_URL || 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
