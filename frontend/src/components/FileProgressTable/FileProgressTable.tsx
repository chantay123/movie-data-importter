import type { FileProgress } from '../../types/api.types';
import { ImportStatus } from '../../types/movieImport.types';
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
                <td className="mono">{file.fileName}</td>
                <td>{formatBytes(file.fileSize)}</td>
                <td className="muted">{file.sourceFormat ?? '-'}</td>
                <td>
                  <span className={`badge badge--${file.status}`}>{file.status}</span>
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
