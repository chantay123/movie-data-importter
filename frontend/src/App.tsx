import { useCallback, useMemo, useState } from 'react';
import { DatabaseComparison } from './components/DatabaseComparison/DatabaseComparison';
import { FieldDiffViewer } from './components/FieldDiffViewer/FieldDiffViewer';
import { FileProgressTable } from './components/FileProgressTable/FileProgressTable';
import { FolderUploader } from './components/FolderUploader/FolderUploader';
import { ImportConfirmation } from './components/ImportConfirmation/ImportConfirmation';
import { ImportDashboard } from './components/ImportDashboard/ImportDashboard';
import { ImportHistory } from './components/ImportHistory/ImportHistory';
import { JsonPreview } from './components/JsonPreview/JsonPreview';
import { useDatabaseComparison } from './hooks/useDatabaseComparison';
import { useFolderUpload } from './hooks/useFolderUpload';
import { useImportProgress } from './hooks/useImportProgress';
import {
  cancelImportJob,
  createImportJob,
  fetchHealth,
  retryFile,
} from './services/importerApi.service';
import type { FileProgress } from './types/api.types';
import { MatchStatus } from './types/movieImport.types';

/**
 * Admin panel of the movie data importer.
 *
 * @returns The rendered component.
 */
export default function App(): JSX.Element {
  const upload = useFolderUpload();
  const [jobId, setJobId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [targetMovieId, setTargetMovieId] = useState<string | undefined>(undefined);

  const progress = useImportProgress(jobId);
  const comparison = useDatabaseComparison(progress.comparisons);

  const files = useMemo(() => progress.job?.files ?? [], [progress.job]);

  const selectedFile: FileProgress | undefined = useMemo(
    () => files.find((file) => file.id === comparison.selectedFileId),
    [files, comparison.selectedFileId],
  );

  const selectedFields = useMemo(() => {
    if (!comparison.comparison) {
      return [];
    }

    return comparison.getSelection(comparison.comparison.fileId);
  }, [comparison]);

  /**
   * Checks whether the importer can reach the database.
   */
  const checkHealth = useCallback(async (): Promise<void> => {
    try {
      const health = await fetchHealth();
      setDbConnected(health.database.connected && health.database.configured);
    } catch {
      setDbConnected(false);
    }
  }, []);

  /**
   * Starts the processing of the selected files.
   */
  const handleStart = async (): Promise<void> => {
    setIsStarting(true);
    setError(null);
    setTargetMovieId(undefined);

    try {
      const createdJobId = await createImportJob(upload.files);
      setJobId(createdJobId);
      await checkHealth();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * Cancels the running job.
   */
  const handleCancel = async (): Promise<void> => {
    if (!jobId) {
      return;
    }

    try {
      await cancelImportJob(jobId);
      await progress.refresh();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    }
  };

  /**
   * Retries a single failed file.
   */
  const handleRetry = async (file: FileProgress): Promise<void> => {
    if (!jobId) {
      return;
    }

    try {
      await retryFile(jobId, file.id);
      await progress.refresh();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : String(retryError));
    }
  };

  const isAmbiguous = comparison.comparison?.matchStatus === MatchStatus.AMBIGUOUS;

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">Movie Data Importer</h1>
          <p className="app__subtitle">
            Upload folder TXT → parse → mapping theo schema Movie → đối chiếu MongoDB → import trực
            tiếp
          </p>
        </div>
        <div className="btn-row">
          <span className="pill">
            MongoDB:{' '}
            {dbConnected === null ? 'chưa kiểm tra' : dbConnected ? 'đã kết nối' : 'chưa kết nối'}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => void checkHealth()}>
            Kiểm tra kết nối
          </button>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {progress.error ? <div className="alert alert--error">{progress.error}</div> : null}

      <FolderUploader
        files={upload.files}
        totalSize={upload.totalSize}
        isReading={upload.isReading || isStarting}
        error={upload.error}
        onSelectFolder={(fileList) => void upload.selectFiles(fileList)}
        onAddFiles={(fileList) => void upload.addFiles(fileList)}
        onClear={upload.clear}
        onStart={() => void handleStart()}
        isRunning={Boolean(jobId) && (progress.job?.cancelled ?? false) === false}
      />

      <ImportDashboard
        counters={progress.job?.counters ?? null}
        isConnected={progress.isConnected}
        cancelled={progress.job?.cancelled ?? false}
        onCancel={() => void handleCancel()}
      />

      <FileProgressTable
        files={files}
        selectedFileId={comparison.selectedFileId}
        onSelect={comparison.selectFile}
        onRetry={(file) => void handleRetry(file)}
      />

      <JsonPreview
        jobId={jobId}
        fileId={selectedFile?.id ?? null}
        fileName={selectedFile?.fileName}
      />

      <DatabaseComparison
        comparison={comparison.comparison}
        targetMovieId={targetMovieId}
        onSelectTarget={setTargetMovieId}
      />

      <FieldDiffViewer
        diffs={comparison.comparison?.diffs ?? []}
        selectedFields={selectedFields}
        updatableFields={comparison.updatableFields}
        onToggle={comparison.toggleField}
        onSelectAll={comparison.selectAll}
        onClearAll={comparison.clearSelection}
      />

      {isAmbiguous && !targetMovieId ? (
        <div className="alert alert--warning">
          Phim này có nhiều bản ghi trùng. Bạn phải chọn một bản ghi ở mục D trước khi import.
        </div>
      ) : null}

      <ImportConfirmation
        jobId={jobId}
        files={files}
        counters={progress.job?.counters ?? null}
        getSelection={comparison.getSelection}
        targetMovieId={targetMovieId}
        logs={progress.job?.logs ?? []}
        onImported={() => void progress.refresh()}
      />

      <ImportHistory />
    </div>
  );
}