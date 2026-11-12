import { useRef } from 'react';
import type { SelectedFile } from '../../services/importerApi.service';
import { formatBytes } from '../../utils/format';

/**
 * Props of the {@link FolderUploader} component.
 */
export interface FolderUploaderProps {
  /** Files already selected. */
  files: SelectedFile[];
  /** Total size of the selected files, in bytes. */
  totalSize: number;
  /** Whether the files are currently being read. */
  isReading: boolean;
  /** Error message when the reading failed. */
  error: string | null;
  /** Called when the user picks a new folder. */
  onSelectFolder: (fileList: FileList | null) => void;
  /** Called when the user adds more files. */
  onAddFiles: (fileList: FileList | null) => void;
  /** Called when the user clears the selection. */
  onClear: () => void;
  /** Called when the user starts the processing. */
  onStart: () => void;
  /** Whether a job is currently running. */
  isRunning: boolean;
}

/**
 * Folder uploader of the admin panel.
 *
 * @param props - The props of the component.
 * @returns The rendered component.
 */
export function FolderUploader(props: FolderUploaderProps): JSX.Element {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="card">
      <h2 className="card__title">
        <span>A. Chọn folder chứa file TXT</span>
        <span className="muted">Tổng: {formatBytes(props.totalSize)}</span>
      </h2>

      {props.error ? <div className="alert alert--error">{props.error}</div> : null}

      <div
        className="dropzone"
        onClick={() => folderInputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          props.onAddFiles(event.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            folderInputRef.current?.click();
          }
        }}
      >
        <div className="dropzone__title">Nhấn để chọn folder hoặc kéo thả file vào đây</div>
        <div className="muted">Chỉ các file .txt được xử lý</div>
      </div>

      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        // @ts-expect-error The `webkitdirectory` attribute is not part of the React typings.
        webkitdirectory=""
        directory=""
        onChange={(event) => {
          props.onSelectFolder(event.target.files);
          event.target.value = '';
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt"
        hidden
        onChange={(event) => {
          props.onAddFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={props.isReading}
        >
          Thêm file
        </button>
        <button
          type="button"
          className="btn"
          onClick={props.onClear}
          disabled={props.files.length === 0 || props.isRunning}
        >
          Xóa danh sách
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={props.onStart}
          disabled={props.files.length === 0 || props.isReading || props.isRunning}
        >
          {props.isReading ? 'Đang đọc file...' : 'Bắt đầu xử lý'}
        </button>
        {props.files.length > 0 ? (
          <span className="pill">{props.files.length} file</span>
        ) : null}
      </div>

      {props.files.length > 0 ? (
        <div className="file-list">
          {props.files.map((file) => (
            <div className="file-row" key={file.name}>
              <span className="mono">{file.name}</span>
              <span className="muted">{formatBytes(file.size)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          Chưa có file nào được chọn.
        </p>
      )}
    </section>
  );
}
