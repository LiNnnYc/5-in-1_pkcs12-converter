import { readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type RotateOptions = {
  logsDir: string;
  maxFiles?: number;     // keep at most this many app-*.log
  maxTotalBytes?: number; // additionally cap total size
};

const DEFAULT_MAX_FILES = 14;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const FILE_PATTERN = /^app-\d{4}-\d{2}-\d{2}_#?[0-9a-f]{8}\.log$/i;

// Best-effort rotation: failures are silent so logging never blocks app startup.
export function rotateLogs(options: RotateOptions): void {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = options.maxTotalBytes ?? DEFAULT_MAX_BYTES;

  let entries: { path: string; size: number; mtime: number }[];
  try {
    mkdirSync(options.logsDir, { recursive: true });
    entries = readdirSync(options.logsDir)
      .filter((n) => FILE_PATTERN.test(n))
      .map((n) => {
        const p = join(options.logsDir, n);
        const st = statSync(p);
        return { path: p, size: st.size, mtime: st.mtimeMs };
      });
  } catch {
    return;
  }

  // newest first
  entries.sort((a, b) => b.mtime - a.mtime);

  // Trim by file count first.
  const overCount = entries.slice(maxFiles);
  for (const e of overCount) {
    tryRm(e.path);
  }
  let kept = entries.slice(0, maxFiles);

  // Then trim oldest until total bytes under cap.
  let total = kept.reduce((s, e) => s + e.size, 0);
  while (total > maxBytes && kept.length > 0) {
    const victim = kept.pop()!; // oldest
    tryRm(victim.path);
    total -= victim.size;
  }
}

function tryRm(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // ignore
  }
}
