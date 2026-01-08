import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = "tmp/logs";
export const SESSION_LOG_FILE = join(LOG_DIR, "session.log");

// Ensure log directory exists and clear logs on module load (server start)
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// Clear session log on server start
writeFileSync(SESSION_LOG_FILE, `--- Session started at ${new Date().toISOString()} ---\n`);
console.log(`[Debug] Session log initialized: ${SESSION_LOG_FILE}`);

interface LogEntry {
  level: "log" | "warn" | "error";
  prefix: string;
  message: string;
  data?: unknown;
  timestamp?: string;
}

export const handleDebugLog = async (req: Request): Promise<Response> => {
  try {
    const body = (await req.json()) as LogEntry;
    const { level = "log", prefix, message, data, timestamp } = body;

    const ts = timestamp || new Date().toISOString();

    // Format log line
    let logLine = `[${ts}] [${level.toUpperCase()}] ${prefix} ${message}`;
    if (data !== undefined) {
      logLine += ` ${JSON.stringify(data)}`;
    }
    logLine += `\n`;

    // Append to file
    appendFileSync(SESSION_LOG_FILE, logLine);

    // Also log to server console for real-time viewing
    const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleMethod(`[ClientLog] ${prefix} ${message}`, data !== undefined ? data : "");

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Debug] Failed to process log:", err);
    return new Response(JSON.stringify({ error: "Failed to log" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const handleClearDebugLog = (): Response => {
  try {
    writeFileSync(SESSION_LOG_FILE, `--- Log cleared at ${new Date().toISOString()} ---\n`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Debug] Failed to clear log:", err);
    return new Response(JSON.stringify({ error: "Failed to clear log" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const handleGetDebugLog = (): Response => {
  try {
    const content = existsSync(SESSION_LOG_FILE) ? readFileSync(SESSION_LOG_FILE, "utf-8") : "No logs yet.";
    return new Response(content, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err) {
    console.error("[Debug] Failed to read log:", err);
    return new Response("Failed to read log", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
};
