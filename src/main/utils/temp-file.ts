import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLogger } from "./logger";

const log = createLogger("temp-file");

export type TempFileManagerOptions = {
  workDir: string;
};

export class TempFileManager {
  private readonly workDir: string;
  private readonly tracked = new Set<string>();
  private exitHandlersRegistered = false;

  constructor(options: TempFileManagerOptions) {
    this.workDir = options.workDir;
  }

  resolveWorkDir(): string {
    return this.workDir;
  }

  ensureWorkDir(): void {
    mkdirSync(this.workDir, { recursive: true });
  }

  // Create (or reserve) a tracked path inside workDir. If `content` is provided, writes it.
  createTempFile(name: string, content?: string | Buffer): string {
    this.ensureWorkDir();
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
    const unique = `${randomBytes(4).toString("hex")}-${safe}`;
    const full = join(this.workDir, unique);
    if (content !== undefined) {
      writeFileSync(full, content);
    }
    this.tracked.add(full);
    return full;
  }

  trackFile(path: string): void {
    this.tracked.add(path);
  }

  cleanup(): void {
    const removedCount = this.tracked.size;
    for (const file of this.tracked) {
      try {
        rmSync(file, { force: true });
      } catch {
        // best effort
      }
    }
    this.tracked.clear();
    // Also remove workDir if empty
    try {
      rmSync(this.workDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    if (removedCount > 0) log.info("cleanup", { removedCount });
  }

  registerProcessExitHandlers(): void {
    if (this.exitHandlersRegistered) return;
    this.exitHandlersRegistered = true;
    const handler = () => this.cleanup();
    process.on("beforeExit", handler);
    process.on("exit", handler);
    process.on("SIGINT", () => {
      handler();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      handler();
      process.exit(143);
    });
    process.on("uncaughtException", (err) => {
      handler();
      // rethrow to keep default behavior
      throw err;
    });
  }
}
