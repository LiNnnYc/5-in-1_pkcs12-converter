import { existsSync, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { redact } from "./log-redact";
import { rotateLogs } from "./log-rotate";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown, err?: unknown) => void;
};

type LoggerState = {
  enabled: boolean;
  sessionId: string;
  logsDir: string;
  filePath: string | null;
  fd: number | null;
  buffer: string[];
  minLevel: LogLevel;
};

const BUFFER_CAP = 200;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const state: LoggerState = {
  enabled: false,
  sessionId: "",
  logsDir: "",
  filePath: null,
  fd: null,
  buffer: [],
  minLevel: "info"
};

export type InitLoggerOptions = {
  exeDir: string;       // resolved by path-resolver
  forceEnable?: boolean; // for tests
  argv?: string[];
  settingsEnabled?: boolean; // from settings.json (user UI toggle)
  minLevel?: LogLevel;       // from settings.json
};

// Decide enable from CLI flag, env var, marker file, or settings.json.
function isEnabled(opts: InitLoggerOptions): boolean {
  if (opts.forceEnable) return true;
  const argv = opts.argv ?? process.argv;
  if (argv.includes("--debug")) return true;
  if (process.env.PKCS12_DEBUG === "1") return true;
  const marker = join(opts.exeDir, "logs", ".enabled");
  if (existsSync(marker)) return true;
  if (opts.settingsEnabled) return true;
  return false;
}

function dateStamp(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function initLogger(opts: InitLoggerOptions): void {
  // Always assign sessionId (renderer can read it even if logging disabled —
  // useful for "please report" UX).
  state.sessionId = `#${randomBytes(4).toString("hex")}`;
  state.logsDir = join(opts.exeDir, "logs");
  state.buffer = [];
  state.minLevel = opts.minLevel ?? "info";

  // Always register safety-net handlers so uncaught errors trigger the
  // buffer-flush path even when logging started disabled.
  process.on("unhandledRejection", (reason) => {
    write("error", "process", "unhandledRejection", undefined, reason);
  });
  process.on("uncaughtException", (err) => {
    write("error", "process", "uncaughtException", undefined, err);
  });

  if (!isEnabled(opts)) {
    // Disabled but armed: keep a small in-memory ring buffer; flush to a
    // real log file only if an error actually occurs.
    state.enabled = false;
    return;
  }

  openLogFile();
}

function openLogFile(): boolean {
  try {
    mkdirSync(state.logsDir, { recursive: true });
    rotateLogs({ logsDir: state.logsDir });
    const filename = `app-${dateStamp()}_${state.sessionId}.log`;
    state.filePath = join(state.logsDir, filename);
    state.fd = openSync(state.filePath, "a");
    state.enabled = true;
    // Flush anything already buffered before the file existed.
    for (const ln of state.buffer) {
      try { writeSync(state.fd, ln); } catch { /* ignore */ }
    }
    state.buffer = [];
    return true;
  } catch {
    state.enabled = false;
    state.filePath = null;
    state.fd = null;
    return false;
  }
}

export function getSessionId(): string {
  return state.sessionId;
}

// Runtime log-level change. Cheap because it's just a filter threshold —
// no fd / buffer state to reconcile, unlike enable/disable.
export function setLogLevel(level: LogLevel): void {
  state.minLevel = level;
}

export function isLoggerEnabled(): boolean {
  return state.enabled;
}

export function getLogFilePath(): string | null {
  return state.filePath;
}

export function shutdownLogger(): void {
  if (state.fd !== null) {
    try { closeSync(state.fd); } catch { /* ignore */ }
    state.fd = null;
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (msg, meta) => write("debug", scope, msg, meta),
    info: (msg, meta) => write("info", scope, msg, meta),
    warn: (msg, meta) => write("warn", scope, msg, meta),
    error: (msg, meta, err) => write("error", scope, msg, meta, err)
  };
}

function write(
  level: LogLevel,
  scope: string,
  msg: string,
  meta?: unknown,
  err?: unknown
): void {
  if (!state.sessionId) return; // logger not initialized yet
  // Errors always flow through (they trigger lazy file open even when disabled).
  if (level !== "error" && LEVEL_RANK[level] < LEVEL_RANK[state.minLevel]) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    sessionId: state.sessionId,
    level,
    scope,
    msg
  };
  if (meta !== undefined) record.meta = redact(meta);
  if (err !== undefined) record.err = serializeError(err);
  const line = JSON.stringify(record) + "\n";

  if (state.enabled && state.fd !== null) {
    try { writeSync(state.fd, line); } catch { /* ignore */ }
    return;
  }

  // Buffer while disabled. On first error, open the file lazily and flush.
  state.buffer.push(line);
  if (state.buffer.length > BUFFER_CAP) state.buffer.shift();
  if (level === "error") openLogFile();
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: (err as NodeJS.ErrnoException).code
    };
  }
  return redact(err);
}

// Test-only escape hatch to reset module state between tests.
export function _resetForTests(): void {
  shutdownLogger();
  state.enabled = false;
  state.sessionId = "";
  state.logsDir = "";
  state.filePath = null;
  state.fd = null;
  state.buffer = [];
  state.minLevel = "info";
}
