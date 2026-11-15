import { useCallback, useRef, useState } from 'react';
import type { SelectedFile } from '../services/importerApi.service';

/**
 * Hook that reads the `.txt` files selected by the user.
 *
 * The folder is read through the `webkitdirectory` attribute of the file
 * input, which lets the browser expose every file of the selected folder.
 */
export interface UseFolderUploadResult {
  /** Files ready to be uploaded. */
  files: SelectedFile[];
  /** Total size of the selected files in bytes. */
  totalSize: number;
  /** Whether the files are currently being read. */
  isReading: boolean;
  /** Error message when the reading failed. */
  error: string | null;
  /** Replaces the current selection with the content of the given files. */
  selectFiles: (fileList: FileList | null) => Promise<void>;
  /** Adds files to the current selection. */
  addFiles: (fileList: FileList | null) => Promise<void>;
  /** Clears the current selection. */
  clear: () => void;
}

/**
 * Maximum size accepted for a single file, in bytes.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Reads a `File` object into a string.
 *
 * @param file - The file to read.
 * @returns The content of the file.
 */
async function readFile(file: File): Promise<string> {
  return file.text();
}

/**
 * Reads the relative path of a file selected inside a folder.
 *
 * The `webkitRelativePath` attribute is only filled when the folder input is
 * used. The plain file input leaves it empty, in which case the name of the
 * file is used.
 *
 * @param file - The file to read.
 * @returns The relative path of the file.
 */
function readRelativePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;

  return relative && relative.length > 0 ? relative : file.name;
}

/**
 * Reads a folder of `.txt` files.
 *
 * @returns The state and the actions of the folder uploader.
 */
export function useFolderUpload(): UseFolderUploadResult {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  const loadFiles = useCallback(async (fileList: FileList | null): Promise<SelectedFile[]> => {
    if (!fileList) {
      return [];
    }

    const accepted: SelectedFile[] = [];

    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith('.txt')) {
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError(`"${file.name}" vượt quá giới hạn ${MAX_FILE_SIZE} byte và đã bị bỏ qua.`);
        continue;
      }

      try {
        const content = await readFile(file);
        accepted.push({ name: file.name, path: readRelativePath(file), size: file.size, content });
      } catch (readError) {
        const message = readError instanceof Error ? readError.message : String(readError);
        setError(`Không thể đọc "${file.name}": ${message}`);
      }
    }

    counter.current += 1;
    return accepted;
  }, []);

  const selectFiles = useCallback(
    async (fileList: FileList | null): Promise<void> => {
      setIsReading(true);
      setError(null);

      try {
        const accepted = await loadFiles(fileList);
        setFiles(accepted);
      } finally {
        setIsReading(false);
      }
    },
    [loadFiles],
  );

  const addFiles = useCallback(
    async (fileList: FileList | null): Promise<void> => {
      setIsReading(true);
      setError(null);

      try {
        const accepted = await loadFiles(fileList);
        setFiles((current) => {
          // The relative path is the identity of a file inside a folder: two
          // files of different sub-folders can share the same name.
          const known = new Set(current.map((file) => file.path));
          return [...current, ...accepted.filter((file) => !known.has(file.path))];
        });
      } finally {
        setIsReading(false);
      }
    },
    [loadFiles],
  );

  const clear = useCallback((): void => {
    setFiles([]);
    setError(null);
  }, []);

  const totalSize = files.reduce((total, file) => total + file.size, 0);

  return { files, totalSize, isReading, error, selectFiles, addFiles, clear };
}
