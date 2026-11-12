/**
 * Formatting helpers shared by the components of the admin panel.
 */

/**
 * Formats a number of bytes into a human readable string.
 *
 * @param bytes - Number of bytes.
 * @returns The formatted size.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Formats an ISO timestamp into a readable local time.
 *
 * @param value - ISO timestamp.
 * @returns The formatted time, or an empty string when the value is missing.
 */
export function formatTime(value?: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('vi-VN');
}

/**
 * Formats an ISO timestamp into a readable local date and time.
 *
 * @param value - ISO timestamp.
 * @returns The formatted date and time.
 */
export function formatDateTime(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('vi-VN');
}
