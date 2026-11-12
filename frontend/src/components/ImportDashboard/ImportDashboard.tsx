import type { JobCounters } from '../../types/api.types';

/**
 * Props of the {@link ImportDashboard} component.
 */
export interface ImportDashboardProps {
  /** Aggregate counters of the job. */
  counters: JobCounters | null;
  /** Whether the realtime stream is connected. */
  isConnected: boolean;
  /** Whether the job was cancelled. */
  cancelled: boolean;
  /** Called when the user cancels the job. */
  onCancel: () => void;
}

/**
 * Displays the counters and the overall progress of the import.
 *
 * @param props - The props of the component.
 * @returns The rendered component.
 */
export function ImportDashboard(props: ImportDashboardProps): JSX.Element {
  const counters = props.counters;

  return (
    <section className="card">
      <h2 className="card__title">
        <span>B. Tiến trình xử lý</span>
        <span className="btn-row">
          {props.isConnected ? (
            <span className="pill">
              <span className="spinner" /> Đang kết nối realtime
            </span>
          ) : (
            <span className="pill">Đang dùng chế độ polling</span>
          )}
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={props.onCancel}
            disabled={props.cancelled || !counters || counters.processed === counters.total}
          >
            Hủy xử lý
          </button>
        </span>
      </h2>

      {!counters ? (
        <p className="muted">Chưa có dữ liệu. Hãy chọn folder và bắt đầu xử lý.</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat__label">Tổng số file</div>
              <div className="stat__value">{counters.total}</div>
            </div>
            <div className="stat stat--info">
              <div className="stat__label">Đã xử lý</div>
              <div className="stat__value">{counters.processed}</div>
            </div>
            <div className="stat stat--success">
              <div className="stat__label">Thành công</div>
              <div className="stat__value">{counters.success}</div>
            </div>
            <div className="stat stat--danger">
              <div className="stat__label">Thất bại</div>
              <div className="stat__value">{counters.failed}</div>
            </div>
            <div className="stat stat--warning">
              <div className="stat__label">Cần kiểm tra</div>
              <div className="stat__value">{counters.needsReview}</div>
            </div>
            <div className="stat stat--success">
              <div className="stat__label">Đã import DB</div>
              <div className="stat__value">{counters.imported}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Đang xử lý</div>
              <div className="stat__value">{counters.processing}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Bỏ qua / Hủy</div>
              <div className="stat__value">
                {counters.skipped} / {counters.cancelled}
              </div>
            </div>
          </div>

          <div className="toolbar">
            <strong>Tiến trình tổng thể: {counters.overallProgress}%</strong>
          </div>
          <div className="progress">
            <div className="progress__bar" style={{ width: `${counters.overallProgress}%` }} />
          </div>

          {props.cancelled ? (
            <div className="alert alert--warning" style={{ marginTop: 12 }}>
              Job đã bị hủy. Các file còn lại không được xử lý.
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
