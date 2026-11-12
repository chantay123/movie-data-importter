import type { FieldDiff } from '../../types/api.types';

/**
 * Props of the {@link FieldDiffViewer} component.
 */
export interface FieldDiffViewerProps {
  /** Comparisons of every field. */
  diffs: FieldDiff[];
  /** Fields currently selected for the update. */
  selectedFields: string[];
  /** Fields that can safely be written for the selected movie. */
  updatableFields: string[];
  /** Called when the user toggles a field. */
  onToggle: (field: string) => void;
  /** Called when the user selects every updatable field. */
  onSelectAll: () => void;
  /** Called when the user clears the selection. */
  onClearAll: () => void;
}

/**
 * Formats a value into a readable string.
 *
 * @param value - The value to format.
 * @returns The formatted value.
 */
function formatValue(value: unknown): string {
  if (value === undefined) {
    return '(không có)';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value.length > 0 ? value : '(chuỗi rỗng)';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

/**
 * Displays the comparison of every field and lets the user pick the fields
 * that must be written to MongoDB.
 *
 * @param props - The props of the component.
 * @returns The rendered component.
 */
export function FieldDiffViewer(props: FieldDiffViewerProps): JSX.Element {
  if (props.diffs.length === 0) {
    return (
      <section className="card">
        <h2 className="card__title">So sánh dữ liệu</h2>
        <p className="muted">Chưa có dữ liệu để so sánh.</p>
      </section>
    );
  }

  const hasUpdatable = props.updatableFields.length > 0;

  return (
    <section className="card">
      <h2 className="card__title">
        <span>So sánh dữ liệu cũ và mới</span>
        <span className="btn-row">
          <button
            type="button"
            className="btn btn--sm"
            onClick={props.onSelectAll}
            disabled={!hasUpdatable}
          >
            Chọn tất cả trường hợp lệ
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={props.onClearAll}
            disabled={props.selectedFields.length === 0}
          >
            Bỏ chọn tất cả
          </button>
          <span className="pill">
            Đã chọn {props.selectedFields.length}/{props.updatableFields.length}
          </span>
        </span>
      </h2>

      <div className="field-row" style={{ fontWeight: 700, color: 'var(--muted)' }}>
        <span />
        <span>Field</span>
        <span>Database hiện tại</span>
        <span>TXT mới</span>
      </div>

      {props.diffs.map((diff) => {
        const isSelected = props.selectedFields.includes(diff.field);
        const isProtected = diff.isProtected === true;
        const isUpdatable = props.updatableFields.includes(diff.field);

        return (
          <div className="field-row" key={diff.field}>
            <input
              type="checkbox"
              checked={isSelected}
              disabled={!isUpdatable}
              onChange={() => props.onToggle(diff.field)}
              title={
                isProtected
                  ? 'Trường được bảo vệ, không thể ghi đè'
                  : isUpdatable
                    ? 'Chọn trường này để cập nhật'
                    : 'Trường này không thay đổi'
              }
            />
            <div>
              <div className="field-row__name">{diff.field}</div>
              <span className={`badge badge--${diff.status}`}>{diff.status}</span>
              {diff.mergeStrategy ? (
                <span className="pill" style={{ marginLeft: 6 }}>
                  {diff.mergeStrategy}
                </span>
              ) : null}
              {diff.message ? (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {diff.message}
                </div>
              ) : null}
            </div>
            <div className="field-row__value diff-old">{formatValue(diff.currentValue)}</div>
            <div className="field-row__value diff-new">{formatValue(diff.incomingValue)}</div>
          </div>
        );
      })}
    </section>
  );
}
