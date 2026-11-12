import { useCallback, useMemo, useState } from 'react';
import type { MovieComparison } from '../types/api.types';
import { FieldStatus } from '../types/movieImport.types';

/**
 * Hook that manages the selection of the fields to update for every file.
 */
export interface UseDatabaseComparisonResult {
  /** Comparison of the currently selected file. */
  comparison: MovieComparison | null;
  /** Identifier of the currently selected file. */
  selectedFileId: string | null;
  /** Fields selected for the update, indexed by file identifier. */
  selection: Record<string, string[]>;
  /** Selects a file. */
  selectFile: (fileId: string) => void;
  /** Toggles a field of the current file. */
  toggleField: (field: string) => void;
  /** Selects every updatable field of the current file. */
  selectAll: () => void;
  /** Clears the selection of the current file. */
  clearSelection: () => void;
  /** Sets the whole selection of a file. */
  setSelection: (fileId: string, fields: string[]) => void;
  /** Returns the selected fields of a file. */
  getSelection: (fileId: string) => string[];
  /** Fields that can be updated for the current file. */
  updatableFields: string[];
}

/**
 * Builds the default selection of a comparison.
 *
 * Every field that can safely be written is selected by default: the fields
 * that actually differ, plus every field carrying a usable value when the
 * movie does not exist yet.
 *
 * @param comparison - The comparison of the file.
 * @returns The list of fields to update.
 */
function buildDefaultSelection(comparison: MovieComparison | null): string[] {
  if (!comparison) {
    return [];
  }

  if (comparison.updatableFields.length > 0) {
    return [...comparison.updatableFields];
  }

  return comparison.diffs
    .filter(
      (diff) =>
        diff.status === FieldStatus.CHANGED && diff.isProtected !== true,
    )
    .map((diff) => diff.field);
}

/**
 * Manages the comparison of the files and the selection of the fields.
 *
 * @param comparisons - The comparisons of every file of the job.
 * @returns The state of the comparison and the actions of the hook.
 */
export function useDatabaseComparison(comparisons: MovieComparison[]): UseDatabaseComparisonResult {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selection, setSelectionState] = useState<Record<string, string[]>>({});

  const comparison = useMemo(() => {
    if (selectedFileId) {
      const found = comparisons.find((entry) => entry.fileId === selectedFileId);
      if (found) {
        return found;
      }
    }

    return comparisons[0] ?? null;
  }, [comparisons, selectedFileId]);

  const getSelection = useCallback(
    (fileId: string): string[] => {
      const stored = selection[fileId];
      if (stored) {
        return stored;
      }

      const found = comparisons.find((entry) => entry.fileId === fileId);
      return buildDefaultSelection(found ?? null);
    },
    [selection, comparisons],
  );

  const selectFile = useCallback(
    (fileId: string): void => {
      setSelectedFileId(fileId);
    },
    [],
  );

  const setSelection = useCallback((fileId: string, fields: string[]): void => {
    setSelectionState((current) => ({ ...current, [fileId]: fields }));
  }, []);

  const toggleField = useCallback(
    (field: string): void => {
      if (!comparison) {
        return;
      }

      const current = getSelection(comparison.fileId);
      const next = current.includes(field)
        ? current.filter((entry) => entry !== field)
        : [...current, field];

      setSelection(comparison.fileId, next);
    },
    [comparison, getSelection, setSelection],
  );

  const selectAll = useCallback((): void => {
    if (!comparison) {
      return;
    }

    setSelection(comparison.fileId, comparison.updatableFields);
  }, [comparison, setSelection]);

  const clearSelection = useCallback((): void => {
    if (!comparison) {
      return;
    }

    setSelection(comparison.fileId, []);
  }, [comparison, setSelection]);

  const updatableFields = useMemo(() => {
    if (!comparison) {
      return [];
    }

    if (comparison.updatableFields.length > 0) {
      return [...comparison.updatableFields];
    }

    return comparison.diffs
      .filter((diff) => diff.status === FieldStatus.CHANGED && diff.isProtected !== true)
      .map((diff) => diff.field);
  }, [comparison]);

  return {
    comparison,
    selectedFileId: comparison?.fileId ?? null,
    selection,
    selectFile,
    toggleField,
    selectAll,
    clearSelection,
    setSelection,
    getSelection,
    updatableFields,
  };
}
