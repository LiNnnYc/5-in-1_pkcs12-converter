// Recursive redactor for log meta. Goal: never let a password — or anything that
// looks like one — reach disk. Spec.md §7 forbids password persistence; this is
// the last line of defense behind logger plumbing.

const FORBIDDEN_KEYS = /password|passphrase|pfx.?pw|export.?pw|key.?pw|secret|storepass/i;

const FORBIDDEN_ENV = new Set([
  "EXPORT_PASSWORD",
  "KEY_PASSWORD",
  "PFX_PASSWORD",
  "STORE_PASSWORD",
  "NEW_STORE_PASSWORD"
]);

const REDACTED = "***";
const MAX_DEPTH = 8;

export function redact(value: unknown): unknown {
  return redactInternal(value, 0, new WeakSet());
}

function redactInternal(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") return value;
  if (t === "number" || t === "boolean" || t === "bigint") return value;
  if (t === "function" || t === "symbol") return undefined;

  if (Array.isArray(value)) {
    return value.map((v) => redactInternal(v, depth + 1, seen));
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);

    // Drop process.env-like objects entirely if any forbidden env key appears.
    // execFile options.env should never be logged in raw form.
    if (looksLikeEnv(obj)) {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (FORBIDDEN_ENV.has(k) || FORBIDDEN_KEYS.test(k)) {
          cleaned[k] = REDACTED;
        } else {
          cleaned[k] = redactInternal(v, depth + 1, seen);
        }
      }
      return cleaned;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactInternal(v, depth + 1, seen);
      }
    }
    return out;
  }

  return value;
}

function looksLikeEnv(obj: Record<string, unknown>): boolean {
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_ENV.has(k)) return true;
  }
  return false;
}

export const _internals = { FORBIDDEN_KEYS, FORBIDDEN_ENV };
