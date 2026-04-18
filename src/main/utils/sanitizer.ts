import { accessSync, constants, statSync } from "node:fs";
import { extname, dirname, isAbsolute, normalize } from "node:path";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

const FORBIDDEN_CHARS = /[\u0000-\u001f]/;

// Validate that path is a non-empty string free of control chars and is absolute.
// Note: we do NOT perform any shell escaping — execFile handles quoting.
function validatePathShape(path: unknown): ValidationResult {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, reason: "Path must be a non-empty string" };
  }
  if (FORBIDDEN_CHARS.test(path)) {
    return { ok: false, reason: "Path contains control characters" };
  }
  if (!isAbsolute(path)) {
    return { ok: false, reason: "Path must be absolute" };
  }
  return { ok: true };
}

export function validateFilePath(path: unknown): ValidationResult {
  const shape = validatePathShape(path);
  if (!shape.ok) return shape;
  const p = path as string;
  try {
    const st = statSync(p);
    if (!st.isFile()) {
      return { ok: false, reason: "Path is not a regular file" };
    }
    accessSync(p, constants.R_OK);
    return { ok: true };
  } catch {
    return { ok: false, reason: "File does not exist or is not readable" };
  }
}

export function validateOutputPath(path: unknown): ValidationResult {
  const shape = validatePathShape(path);
  if (!shape.ok) return shape;
  const parent = dirname(normalize(path as string));
  try {
    const st = statSync(parent);
    if (!st.isDirectory()) {
      return { ok: false, reason: "Output parent is not a directory" };
    }
    accessSync(parent, constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false, reason: "Output parent directory is missing or not writable" };
  }
}

export function validateOutputDir(path: unknown): ValidationResult {
  const shape = validatePathShape(path);
  if (!shape.ok) return shape;
  const p = path as string;
  try {
    const st = statSync(p);
    if (!st.isDirectory()) {
      return { ok: false, reason: "Path is not a directory" };
    }
    accessSync(p, constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false, reason: "Directory does not exist or is not writable" };
  }
}

export function validatePassword(pw: unknown): ValidationResult {
  if (typeof pw !== "string" || pw.length === 0) {
    return { ok: false, reason: "Password must be a non-empty string" };
  }
  if (pw.includes("\u0000")) {
    return { ok: false, reason: "Password contains NUL byte" };
  }
  return { ok: true };
}

// Keytool refuses passwords under 6 chars with an opaque error. Enforce up-front
// so convert-service surfaces a clean validation message instead of raw Keytool stderr.
export function validateKeystorePassword(pw: unknown): ValidationResult {
  const base = validatePassword(pw);
  if (!base.ok) return base;
  if ((pw as string).length < 6) {
    return { ok: false, reason: "Keystore password must be at least 6 characters" };
  }
  return { ok: true };
}

export function validateFileExtension(path: unknown, allowedExts: string[]): ValidationResult {
  if (typeof path !== "string") {
    return { ok: false, reason: "Path must be a string" };
  }
  const ext = extname(path).toLowerCase().replace(/^\./, "");
  const allowed = allowedExts.map((e) => e.toLowerCase().replace(/^\./, ""));
  if (!allowed.includes(ext)) {
    return { ok: false, reason: `Extension .${ext} not in allowed list: ${allowed.join(", ")}` };
  }
  return { ok: true };
}
