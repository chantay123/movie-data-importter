import { useEffect, useState } from 'react';
import { fetchHistory } from '../../services/importerApi.service';
import type { ImportLogEntry } from '../../types/api.types';

/**
 * Shape of a persisted import run.
 */
interface HistoryRun {
  id: string;
  createdAt: string;
  logs: ImportLogEntry[];
}

/**
 * Displays the history of the previous imports.
 *
 * @returns The rendered component.
 */
export function ImportHistory(): JSX.Element {
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void fetchHistory()
      .then((result): void => {
        if (!cancelled) {
          setRuns(result.history as unknown as HistoryRun[]);
          setError(null);
        }
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
  }, []);

  return (
    <section className="card">
      <h2 className="card__title">
        <span>F. Lịch sử import</span>
        <span className="muted">{runs.length} lần chạy</span>
      </h2>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {isLoading ? (
        <p className="muted">
          <span className="spinner" /> Đang tải lịch sử...
        </p>
      ) : runs.length === 0 ? (
        <p className="muted">Chưa có lịch sử import nào.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>File</th>
                <th>Phim</th>
                <th>Document ID</th>
                <th>Thao tác</th>
                <th>Trường đã cập nhật</th>
                <th>Trạng thái</th>
                <th>Lỗi</th>
              </tr>
            </thead>
            <tbody>
              {runs.flatMap((run) =>
                (run.logs ?? []).map((log, index) => (
                  <tr key={`${run.id}-${index}`}>
                    <td className="muted">{new Date(run.createdAt).toLocaleString('vi-VN')}</td>
                    <td className="mono">{log.fileName}</td>
                    <td>{log.movieName}</td>
                    <td className="mono">{log.movieId ?? '-'}</td>
                    <td>
                      <span className={`badge badge--${log.operation}`}>{log.operation}</span>
                    </td>
                    <td className="muted">{log.updatedFields.join(', ') || '-'}</td>
                    <td>
                      <span className={`badge badge--${log.status}`}>{log.status}</span>
                    </td>
                    <td className="diff-old">{log.error ?? ''}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}