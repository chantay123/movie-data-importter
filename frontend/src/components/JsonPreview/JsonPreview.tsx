import { useEffect, useState } from 'react';
import { exportJob, fetchFileJson } from '../../services/importerApi.service';

/**
 * Props of the {@link JsonPreview} component.
 */
export interface JsonPreviewProps {
  /** Identifier of the job. */
  jobId: string | null;
  /** Identifier of the file to preview. */
  fileId: string | null;
  /** Name of the file to preview. */
  fileName?: string;
}

/**
 * Displays the JSON produced by the parser and offers the export actions.
 *
 * @param props - The props of the component.
 * @returns The rendered component.
 */
export function JsonPreview(props: JsonPreviewProps): JSX.Element {
  const [mode, setMode] = useState<'raw' | 'extracted' | 'mapped'>('raw');
  const [payload, setPayload] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!props.jobId || !props.fileId) {
      setPayload('');
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void fetchFileJson(props.jobId, props.fileId)
      .then((result): void => {
        if (cancelled) {
          return;
        }

        const data =
          mode === 'mapped'
            ? result.mapped
            : mode === 'extracted'
              ? result.extracted
              : result.raw ?? result.extracted;
        setPayload(JSON.stringify(data ?? {}, null, 2));
        setError(null);
      })
      .catch((fetchError: unknown): void => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        }
      })
      .finally((): void => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [props.jobId, props.fileId, mode]);

  /**
   * Copies the current JSON into the clipboard.
   */
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(payload);
    } catch (copyError) {
      const message = copyError instanceof Error ? copyError.message : String(copyError);
      setError(`Không thể copy JSON: ${message}`);
    }
  };

  /**
   * Downloads the JSON of the current file.
   */
  const handleDownloadFile = (): void => {
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${props.fileName ?? 'movie'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Downloads the JSON of every file of the job.
   */
  const handleDownloadAll = async (): Promise<void> => {
    if (!props.jobId) {
      return;
    }

    try {
      const result = await exportJob(props.jobId, mode);
      const blob = new Blob([JSON.stringify(result.movies, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `movie-import-${props.jobId}-${mode}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : String(exportError);
      setError(message);
    }
  };

  return (
    <section className="card">
      <h2 className="card__title">
        <span>C. JSON Preview</span>
        <span className="btn-row">
          <button
            type="button"
            className={`btn btn--sm ${mode === 'raw' ? 'btn--primary' : ''}`}
            onClick={() => setMode('raw')}
          >
            JSON sau parse
          </button>
          <button
            type="button"
            className={`btn btn--sm ${mode === 'extracted' ? 'btn--primary' : ''}`}
            onClick={() => setMode('extracted')}
          >
            JSON bóc tách
          </button>
          <button
            type="button"
            className={`btn btn--sm ${mode === 'mapped' ? 'btn--primary' : ''}`}
            onClick={() => setMode('mapped')}
          >
            JSON theo schema MongoDB
          </button>
          <button type="button" className="btn btn--sm" onClick={() => void handleCopy()}>
            Copy JSON
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={handleDownloadFile}
            disabled={payload.length === 0}
          >
            Download file
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void handleDownloadAll()}
            disabled={!props.jobId}
          >
            Download toàn bộ
          </button>
        </span>
      </h2>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {isLoading ? (
        <p className="muted">
          <span className="spinner" /> Đang tải JSON...
        </p>
      ) : payload.length > 0 ? (
        <pre className="json-view">{payload}</pre>
      ) : (
        <p className="muted">Chưa có dữ liệu JSON để hiển thị.</p>
      )}
    </section>
  );
}
