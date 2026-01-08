/**
 * Debug logger that writes to both console and server log file.
 * Logs are written to logs/debug.log on the server.
 *
 * Usage:
 *   import { debugLog } from './debugLog.js';
 *   const log = debugLog('[NostrConnect]');
 *   log.info('Message here', { optional: 'data' });
 *   log.warn('Warning message');
 *   log.error('Error message', error);
 */

// Queue for batching log entries
let logQueue = [];
let flushTimeout = null;
const FLUSH_DELAY = 100; // ms - batch logs within this window

const flushLogs = async () => {
  if (logQueue.length === 0) return;

  const entries = logQueue;
  logQueue = [];
  flushTimeout = null;

  // Send each entry (could batch further if needed)
  for (const entry of entries) {
    try {
      await fetch("/api/debug/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch (err) {
      // Silently fail - don't want logging to break the app
      console.error("[DebugLog] Failed to send log:", err);
    }
  }
};

const queueLog = (entry) => {
  logQueue.push(entry);
  if (!flushTimeout) {
    flushTimeout = setTimeout(flushLogs, FLUSH_DELAY);
  }
};

/**
 * Create a debug logger with a specific prefix
 * @param {string} prefix - The prefix for all log messages (e.g., '[NostrConnect]')
 * @returns {Object} Logger object with log, info, warn, error methods
 */
export const debugLog = (prefix) => {
  const sendLog = (level, message, data) => {
    const timestamp = new Date().toISOString();

    // Always log to console
    const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (data !== undefined) {
      consoleMethod(`${prefix} ${message}`, data);
    } else {
      consoleMethod(`${prefix} ${message}`);
    }

    // Queue for server
    queueLog({
      level,
      prefix,
      message,
      data,
      timestamp,
    });
  };

  return {
    log: (message, data) => sendLog("log", message, data),
    info: (message, data) => sendLog("log", message, data),
    warn: (message, data) => sendLog("warn", message, data),
    error: (message, data) => sendLog("error", message, data),
  };
};

/**
 * Clear the debug log file on the server
 */
export const clearDebugLog = async () => {
  try {
    await fetch("/api/debug/clear", { method: "POST" });
    console.log("[DebugLog] Log file cleared");
  } catch (err) {
    console.error("[DebugLog] Failed to clear log:", err);
  }
};

// Pre-created loggers for common prefixes
export const nostrConnectLog = debugLog("[NostrConnect]");
export const bunkerLog = debugLog("[Bunker]");
export const authLog = debugLog("[Auth]");
