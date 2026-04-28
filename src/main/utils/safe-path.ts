import { copyFile, readFile, rename, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// OpenSSL 3.x on Windows fails to open files via OSSL_STORE when the path contains
// non-ASCII characters (CJK, emoji, etc.) — stderr shows
// `error:8000002A:system library:file_open:Illegal byte sequence`.
// Detect such paths so callers can route around the limitation by piping content
// through stdin (input) or using a `.work/` ASCII intermediary then `fs.rename` to
// the user-chosen path (output).
export function containsNonAscii(p: string): boolean {
  // ASCII = code points 0x00..0x7F. Anything else triggers the OpenSSL bug.
  // Includes the path separator family (\ /), drive letters, etc. — all ASCII.
  for (let i = 0; i < p.length; i++) {
    if (p.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

// Read a user file via Node fs (Win32 wide-char API; handles Unicode paths correctly)
// for piping into an openssl subprocess via stdin.
export async function readFileForOpenssl(userPath: string): Promise<Buffer> {
  return readFile(userPath);
}

// Run `fn` with a path that openssl can safely open. If `userPath` is ASCII, hand it
// directly. If it contains non-ASCII, allocate an ASCII path under `workDir`, run fn
// against that, then rename the result back to `userPath` on success.
//
// Cross-volume rename: if EXDEV (e.g. user picked a different drive), fall back to
// copyFile + unlink so the move still completes.
//
// On fn() throw or rename failure, the temp file is removed best-effort.
export async function withSafeOutputPath<T>(
  userPath: string,
  workDir: string,
  fn: (asciiPath: string) => Promise<T>
): Promise<T> {
  if (!containsNonAscii(userPath)) {
    return fn(userPath);
  }

  // userPath is non-ASCII; allocate an ASCII tmp inside workDir and rename later.
  mkdirSync(workDir, { recursive: true });
  const ext = extractExt(userPath);
  const tmpName = `${randomBytes(6).toString("hex")}-out${ext}`;
  const tmpPath = join(workDir, tmpName);

  let result: T;
  try {
    result = await fn(tmpPath);
  } catch (e) {
    await unlink(tmpPath).catch(() => undefined);
    throw e;
  }

  if (!existsSync(tmpPath)) {
    // fn succeeded but no file produced — surface as-is; caller will detect.
    return result;
  }

  // Ensure target directory exists (caller may not have validated it yet).
  mkdirSync(dirname(userPath), { recursive: true });

  try {
    await rename(tmpPath, userPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      // Cross-device — fall back to copy + unlink.
      await copyFile(tmpPath, userPath);
      await unlink(tmpPath).catch(() => undefined);
    } else {
      // Don't leave the tmp behind on failure.
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }
  return result;
}

function extractExt(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = p.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  const ext = base.slice(dot);
  // Sanitize ext to ASCII; OpenSSL doesn't care about extension but a non-ASCII
  // ext would defeat the whole purpose of the workaround.
  if (containsNonAscii(ext)) return "";
  return ext;
}
