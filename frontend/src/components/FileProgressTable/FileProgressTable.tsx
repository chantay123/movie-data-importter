import type { FileProgress } from '../../types/api.types';
import { ImportStatus, SkipReason } from '../../types/movieImport.types';
import { formatBytes } from '../../utils/format';

/**
 * Props of the {@link FileProgressTable} component.
 */
export interface FileProgressTableProps {
  /** Progress of every file of the job. */
  files: FileProgress[];
  /** Identifier of the file currently selected. */
  selectedFileId: string | null;
  /** Called when the user selects a file. */
  onSelect: (fileId: string) => void;
  /** Called when the user retries a failed file. */
  onRetry: (file: FileProgress) => void;
}

/**
 * Formats a timestamp into a readable time.
 *
 * @param value - ISO timestamp.
 * @returns The formatted time or an empty string.
 */
function formatTime(value?: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('vi-VN');
}

/**
 * Builds the label of the status of a file.
 *
 * A file that was skipped because the movie already exists and brings no
 * change is displayed as "đã có" instead of the raw `SKIPPED` status.
 *
 * @param file - The file to describe.
 * @returns The label and the CSS modifier of the badge.
 */
function describeStatus(file: FileProgress): { label: string; modifier: string } {
  if (file.status === ImportStatus.SKIPPED) {
    if (file.skipReason === SkipReason.ALREADY_EXISTS) {
      return { label: 'Đã có (không đổi)', modifier: 'UNCHANGED' };
    }

    if (file.skipReason === SkipReason.DUPLICATE_IN_BATCH) {
      return { label: 'Trùng trong lô', modifier: 'DUPLICATE' };
    }
  }

  return { label: file.status, modifier: file.status };
}

/**
 * Table that displays the realtime progress of every file.
 *
 * @param props - The props of the component.
 * @returns The rendered component.
 */
export function FileProgressTable(props: FileProgressTableProps): JSX.Element {
  if (props.files.length === 0) {
    return (
      <section className="card">
        <h2 className="card__title">Danh sách file</h2>
        <p className="muted">Chưa có file nào được xử lý.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="card__title">
        <span>Danh sách file ({props.files.length})</span>
        <span className="muted">Nhấn vào một file để xem chi tiết</span>
      </h2>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tên file</th>
              <th>Dung lượng</th>
              <th>Định dạng</th>
              <th>Trạng thái</th>
              <th>Giai đoạn</th>
              <th style={{ width: 140 }}>Tiến trình</th>
              <th>Tên phim</th>
              <th>Trường</th>
              <th>Server</th>
              <th>Tập</th>
              <th>Đối chiếu DB</th>
              <th>Đã ghi DB</th>
              <th>Thay đổi</th>
              <th>Bắt đầu</th>
              <th>Kết thúc</th>
              <th>Lỗi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.files.map((file) => (
              <tr
                key={file.id}
                className={file.id === props.selectedFileId ? 'is-selected' : undefined}
                onClick={() => props.onSelect(file.id)}
                style={{ cursor: 'pointer' }}
              >
                <td className="mono">
                  {file.fileName}
                  {file.filePath && file.filePath !== file.fileName ? (
                    <div className="muted mono" style={{ fontSize: '0.8em' }}>
                      {file.filePath}
                    </div>
                  ) : null}
                </td>
                <td className="muted">{formatBytes(file.fileSize)}</td>
                <td className="muted">{file.sourceFormat ?? '-'}</td>
                <td>
                  <span className={`badge badge--${describeStatus(file).modifier}`}>
                    {describeStatus(file).label}
                  </span>
                </td>
                <td className="muted">{file.stage}</td>
                <td>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${file.progress}%` }} />
                  </div>
                  <span className="muted">{file.progress}%</span>
                </td>
                <td>{file.detectedName ?? '-'}</td>
                <td>{file.readableFieldCount}</td>
                <td>{file.serverCount ?? '-'}</td>
                <td>{file.episodeCount}</td>
                <td>
                  {file.matchStatus ? (
                    <span className={`badge badge--${file.matchStatus}`}>{file.matchStatus}</span>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  {file.imported === true ? (
                    <span className="badge badge--SUCCESS">Đã ghi</span>
                  ) : file.status === ImportStatus.SKIPPED ? (
                    <span className="muted">—</span>
                  ) : file.status === ImportStatus.PARSED ? (
                    <span className="badge badge--PARSED">Chờ import</span>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="muted">
                  {file.status === ImportStatus.SKIPPED
                    ? file.skipReason === SkipReason.ALREADY_EXISTS
                      ? 'Không có thay đổi'
                      : 'Trùng phim trong lô'
                    : (file.changedFields?.length ?? 0) > 0
                      ? `${file.changedFields?.length} trường: ${file.changedFields?.join(', ')}`
                      : file.status === ImportStatus.PARSED
                        ? 'Không có'
                        : '-'}
                </td>
                <td className="muted">{formatTime(file.startedAt)}</td>
                <td className="muted">{formatTime(file.finishedAt)}</td>
                <td className="diff-old">{file.error ?? ''}</td>
                <td>
                  {file.status === ImportStatus.FAILED ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onRetry(file);
                      }}
                    >
                      Retry
                    </button>
                  ) : file.status === ImportStatus.SKIPPED ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      title="Đối chiếu lại với MongoDB"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onRetry(file);
                      }}
                    >
                      Kiểm tra lại
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
