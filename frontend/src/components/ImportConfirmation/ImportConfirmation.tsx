import { useState } from 'react';
import { importFile } from '../../services/importerApi.service';
import type { FileProgress, ImportLogEntry, JobCounters } from '../../types/api.types';
import { MatchStatus } from '../../types/movieImport.types';

/**
 * Props of the {@link ImportConfirmation} component.
 */
export interface ImportConfirmationProps {
  /** Identifier of the job. */
  jobId: string | null;
  /** Files of the job. */
  files: FileProgress[];
  /** Aggregate counters of the job. */
  counters: JobCounters | null;
  /**
   * Returns the fields to update for a file.
   *
   * When the user never opened a file, the default selection (every field
   * that can safely be written) is used.
   *
   * @param fileId - Identifier of the file.
   * @returns The list of fields.
   */
  getSelection: (fileId: string) => string[];
  /** Document chosen by the user for an ambiguous match. */
  targetMovieId?: string;
  /** Import log of the job. */
  logs: ImportLogEntry[];
  /** Called once an import finished, to refresh the job. */
  onImported: () => void;
}

/**
 * Summary of the import and confirmation button.
 *
 * @param props - The props of the component.
 * @returns The rendered component.
 */
export function ImportConfirmation(props: ImportConfirmationProps): JSX.Element {
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);

  const importable = props.files.filter((file) => {
    if (!file.parsed || file.status === 'FAILED' || file.status === 'CANCELLED') {
      return false;
    }

    if (file.matchStatus === MatchStatus.AMBIGUOUS && !props.targetMovieId) {
      return false;
    }

    return true;
  });

  const creates = importable.filter((file) => file.matchStatus === MatchStatus.NEW).length;
  const updates = importable.filter((file) => file.matchStatus === MatchStatus.MATCHED).length;

  /**
   * Imports every eligible file, one after the other.
   */
  const handleImport = async (): Promise<void> => {
    if (!props.jobId || importable.length === 0) {
      return;
    }

    setIsImporting(true);
    setMessage(null);
    setError(null);

    let succeeded = 0;
    let failed = 0;

    for (const file of importable) {
      try {
        const selected = props.getSelection(file.id);
        await importFile(props.jobId, file.id, selected, dryRun, props.targetMovieId);
        succeeded += 1;
      } catch (importError) {
        failed += 1;
        const failure = importError instanceof Error ? importError.message : String(importError);
        setError(`${file.fileName}: ${failure}`);
      }
    }

    setIsImporting(false);
    setMessage(
      `${dryRun ? 'Dry-run' : 'Import'} hoàn tất: ${succeeded} thành công, ${failed} thất bại.`,
    );
    props.onImported();
  };

  return (
    <section className="card">
      <h2 className="card__title">
        <span>E. Import vào MongoDB</span>
        <span className="btn-row">
          <label className="pill">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(event) => setDryRun(event.target.checked)}
              style={{ marginRight: 6 }}
            />
            Chế độ preview (không ghi vào DB)
          </label>
          <button
            type="button"
            className="btn btn--success"
            onClick={() => void handleImport()}
            disabled={!props.jobId || importable.length === 0 || isImporting}
          >
            {isImporting ? (
              <>
                <span className="spinner" /> Đang import...
              </>
            ) : dryRun ? (
              'Xem trước kết quả import'
            ) : (
              `Xác nhận import (${importable.length} phim)`
            )}
          </button>
        </span>
      </h2>

      {message ? <div className="alert alert--info">{message}</div> : null}
      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="stats">
        <div className="stat">
          <div className="stat__label">Sắp import</div>
          <div className="stat__value">{importable.length}</div>
        </div>
        <div className="stat stat--info">
          <div className="stat__label">Tạo mới</div>
          <div className="stat__value">{creates}</div>
        </div>
        <div className="stat stat--success">
          <div className="stat__label">Cập nhật</div>
          <div className="stat__value">{updates}</div>
        </div>
        <div className="stat stat--warning">
          <div className="stat__label">Bỏ qua</div>
          <div className="stat__value">
            {(props.counters?.skipped ?? 0) + (props.counters?.cancelled ?? 0)}
          </div>
        </div>
        <div className="stat stat--danger">
          <div className="stat__label">Lỗi</div>
          <div className="stat__value">{props.counters?.failed ?? 0}</div>
        </div>
      </div>

      {props.logs.length > 0 ? (
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
              {props.logs.map((log, index) => (
                <tr key={`${log.fileId}-${index}`}>
                  <td className="muted">
                    {new Date(log.timestamp).toLocaleString('vi-VN')}
                  </td>
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
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Chưa có thao tác import nào.</p>
      )}
    </section>
  );
}
