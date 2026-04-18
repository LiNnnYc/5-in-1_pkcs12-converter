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
};

const state: LoggerState = {
  enabled: false,
  sessionId: "",
  logsDir: "",
  filePath: null,
  fd: null
};

export type InitLoggerOptions = {
  exeDir: string;       // resolved by path-resolver
  forceEnable?: boolean; // for tests
  argv?: string[];
};

// Decide enable from CLI flag, env var, or marker file.
function isEnabled(opts: InitLoggerOptions): boolean {
  if (opts.forceEnable) return true;
  const argv = opts.argv ?? process.argv;
  if (argv.includes("--debug")) return true;
  if (process.env.PKCS12_DEBUG === "1") return true;
  const marker = join(opts.exeDir, "logs", ".enabled");
  if (existsSync(marker)) return true;
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
  state.enabled = isEnabled(opts);
  state.logsDir = join(opts.exeDir, "logs");

  if (!state.enabled) return;

  try {
    mkdirSync(state.logsDir, { recursive: true });
    rotateLogs({ logsDir: state.logsDir });
    const filename = `app-${dateStamp()}_${state.sessionId}.log`;
    state.filePath = join(state.logsDir, filename);
    state.fd = openSync(state.filePath, "a");
  } catch {
    // permission / disk full — silently disable, never block app startup.
    state.enabled = false;
    state.filePath = null;
    state.fd = null;
  }

  // Top-level safety net.
  process.on("unhandledRejection", (reason) => {
    write("error", "process", "unhandledRejection", undefined, reason);
  });
  process.on("uncaughtException", (err) => {
    write("error", "process", "uncaughtException", undefined, err);
  });
}

export function getSessionId(): string {
  return state.sessionId;
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
  if (!state.enabled || state.fd === null) return;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    sessionId: state.sessionId,
    level,
    scope,
    msg
  };
  if (meta !== undefined) line.meta = redact(meta);
  if (err !== undefined) line.err = serializeError(err);
  try {
    writeSync(state.fd, JSON.stringify(line) + "\n");
  } catch {
    // ignore — disk full / fd closed shouldn't crash the app.
  }
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
}
