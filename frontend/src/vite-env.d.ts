/// <reference types="vite/client" />

/**
 * Environment variables exposed to the panel by Vite.
 */
interface ImportMetaEnv {
  /** Base URL of the importer API. */
  readonly VITE_IMPORTER_API_URL?: string;
  /** Shared secret used to authenticate against the importer API. */
  readonly VITE_IMPORTER_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
