// Date utility module for timezone-aware date formatting
// SQLite CURRENT_TIMESTAMP stores dates in UTC, but without timezone indicator.
// This module ensures timestamps are properly parsed as UTC and displayed in local time.

/**
 * Parse a SQLite timestamp string as UTC.
 * SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS" (no timezone)
 * @param {string} dateStr - Timestamp from SQLite
 * @returns {Date} - Date object representing the correct moment in time
 */
export function parseUTCTimestamp(dateStr) {
  if (!dateStr) return new Date();
  // If already has timezone info (Z or +/-), parse as-is
  if (dateStr.includes("Z") || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  // SQLite format: "YYYY-MM-DD HH:MM:SS" - append Z to indicate UTC
  // Replace space with T for ISO 8601 compatibility
  const isoStr = dateStr.replace(" ", "T") + "Z";
  return new Date(isoStr);
}

/**
 * Format a timestamp for display (time only, local timezone)
 * @param {string} dateStr - Timestamp from SQLite
 * @returns {string} - Localized time string (e.g., "2:30:45 PM")
 */
export function formatLocalTime(dateStr) {
  const date = parseUTCTimestamp(dateStr);
  return date.toLocaleTimeString();
}

/**
 * Format a timestamp for display (date only, local timezone)
 * @param {string} dateStr - Timestamp from SQLite
 * @returns {string} - Localized date string (e.g., "1/8/2026")
 */
export function formatLocalDate(dateStr) {
  const date = parseUTCTimestamp(dateStr);
  return date.toLocaleDateString();
}

/**
 * Format a timestamp for display (full date and time, local timezone)
 * @param {string} dateStr - Timestamp from SQLite
 * @returns {string} - Localized date/time string (e.g., "1/8/2026, 2:30:45 PM")
 */
export function formatLocalDateTime(dateStr) {
  const date = parseUTCTimestamp(dateStr);
  return date.toLocaleString();
}

/**
 * Format timestamp as DD/MM/YY @ HH:MM (local timezone)
 * @param {string} dateStr - Timestamp from SQLite
 * @returns {string} - Formatted string (e.g., "08/01/26 @ 14:30")
 */
export function formatReplyTimestamp(dateStr) {
  const d = parseUTCTimestamp(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} @ ${hours}:${minutes}`;
}

/**
 * Format timestamp with custom options (local timezone)
 * @param {string} dateStr - Timestamp from SQLite
 * @param {Intl.DateTimeFormatOptions} options - Formatting options
 * @returns {string} - Formatted date string
 */
export function formatLocalCustom(dateStr, options) {
  const date = parseUTCTimestamp(dateStr);
  return date.toLocaleString(undefined, options);
}

/**
 * Format timestamp with short month and day + time (local timezone)
 * @param {string} dateStr - Timestamp from SQLite
 * @returns {string} - Formatted string (e.g., "Jan 8, 2:30 PM")
 */
export function formatShortDateTime(dateStr) {
  const date = parseUTCTimestamp(dateStr);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a Unix timestamp (seconds) as a local date
 * @param {number} unixSeconds - Unix timestamp in seconds
 * @returns {string} - Localized date string
 */
export function formatUnixDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString();
}

/**
 * Format a Unix timestamp (seconds) as a local date/time
 * @param {number} unixSeconds - Unix timestamp in seconds
 * @returns {string} - Localized date/time string
 */
export function formatUnixDateTime(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleString();
}
