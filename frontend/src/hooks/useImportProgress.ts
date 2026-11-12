import { useCallback, useEffect, useRef, useState } from 'react';
import { buildStreamUrl, fetchJob } from '../services/importerApi.service';
import type { ImportJob, MovieComparison } from '../types/api.types';

/**
 * Hook that follows the progress of an import job in real time.
 *
 * The hook opens a Server-Sent Events stream and falls back to a polling
 * mechanism when the stream cannot be established.
 */
export interface UseImportProgressResult {
  /** Current state of the job. */
  job: ImportJob | null;
  /** Comparisons of every file. */
  comparisons: MovieComparison[];
  /** Whether the stream is connected. */
  isConnected: boolean;
  /** Error message when the monitoring failed. */
  error: string | null;
  /** Reloads the job from the API. */
  refresh: () => Promise<void>;
  /** Closes the stream. */
  disconnect: () => void;
}

/**
 * Delay between two polls when the SSE stream is not available.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * Follows the progress of an import job.
 *
 * @param jobId - Identifier of the job, `null` when no job is running.
 * @returns The state of the job and the actions of the hook.
 */
export function useImportProgress(jobId: string | null): UseImportProgressResult {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [comparisons, setComparisons] = useState<MovieComparison[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!jobId) {
      return;
    }

    try {
      const payload = await fetchJob(jobId);
      setJob(payload.job);
      setComparisons(payload.comparisons ?? []);
      setError(null);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      setError(message);
    }
  }, [jobId]);

  const disconnect = useCallback((): void => {
    sourceRef.current?.close();
    sourceRef.current = null;

    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!jobId) {
      disconnect();
      return;
    }

    let cancelled = false;

    void refresh();

    const source = new EventSource(buildStreamUrl(jobId));
    sourceRef.current = source;

    source.addEventListener('open', () => {
      setIsConnected(true);
      setError(null);
    });

    source.addEventListener('job:updated', (event): void => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        job: ImportJob;
      };
      setJob(payload.job);
      setIsConnected(true);
    });

    source.addEventListener('job:created', (event): void => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        job: ImportJob;
      };
      setJob(payload.job);
    });

    source.addEventListener('file:updated', (): void => {
      void refresh();
    });

    source.addEventListener('log:added', (): void => {
      void refresh();
    });

    source.addEventListener('error', (): void => {
      setIsConnected(false);

      // Fallback: poll the API when the stream is not available.
      if (!cancelled && timerRef.current === null) {
        timerRef.current = window.setInterval(() => {
          void refresh();
        }, POLL_INTERVAL_MS);
      }
    });

    return (): void => {
      cancelled = true;
      source.close();
      sourceRef.current = null;

      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [jobId, refresh, disconnect]);

  return { job, comparisons, isConnected, error, refresh, disconnect };
}
