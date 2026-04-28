import { execFile } from "node:child_process";
import type { AliasEntry, AliasEntryType } from "../../types";
import { resolveKeytoolPath } from "../utils/path-resolver";
import { createLogger } from "../utils/logger";

const log = createLogger("keytool");

const DEFAULT_TIMEOUT_MS = 40_000;

export type KeytoolResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunKeytoolOptions = {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export type KeystoreType = "JKS" | "PKCS12";

// execFile wrapper — returns stdout/stderr/exitCode without throwing.
// Password injection pattern mirrors openssl-runner: caller puts the plaintext
// password in `options.env` under a named variable (STORE_PASSWORD, KEY_PASSWORD,
// NEW_STORE_PASSWORD) and passes the argv reference "<key>:env NAME" — e.g.
// `-storepass:env STORE_PASSWORD`. Keytool reads it via the JDK Password API;
// it never shows up on the command line.
export async function runKeytool(
  args: string[],
  options: RunKeytoolOptions = {}
): Promise<KeytoolResult> {
  const keytool = resolveKeytoolPath();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Filter parent *_PASSWORD leakage — same safety as openssl-runner.
  const baseEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/PASSWORD/i.test(k)) continue;
    baseEnv[k] = v;
  }
  const env = { ...baseEnv, ...(options.env ?? {}) };

  // JVM flags:
  //  - file.encoding=UTF-8 so Chinese alias / DN / file paths don't mojibake
  //    on Windows (default cp950 would break parsing of stderr patterns).
  //  - sun.jnu.encoding=UTF-8 controls how the JVM encodes filesystem path
  //    strings when calling native Win32 APIs. Without this, on a non-CJK
  //    Windows the default ANSI codepage (e.g. cp1252) cannot represent CJK
  //    code points and keytool throws "java.io.IOException: Bad pathname"
  //    when -keystore / -srckeystore / -destkeystore points at a path with
  //    non-ASCII characters. Forcing UTF-8 makes the round-trip lossless.
  //  - stdout.encoding=UTF-8 + stderr.encoding=UTF-8 because JDK 18+ split
  //    these from file.encoding; on Windows keytool would still emit cp950
  //    bytes through stdout otherwise, breaking Chinese alias names.
  //  - user.language=en + user.country=US forces English output so stdout
  //    regexes ("Alias name:", "Warning:", error sentinels) match regardless
  //    of the user's system locale. Portable app must not drift by locale.
  const finalArgs = [
    "-J-Dfile.encoding=UTF-8",
    "-J-Dsun.jnu.encoding=UTF-8",
    "-J-Dstdout.encoding=UTF-8",
    "-J-Dstderr.encoding=UTF-8",
    "-J-Duser.language=en",
    "-J-Duser.country=US",
    ...args
  ];

  const startedAt = Date.now();
  try {
    const result = await new Promise<KeytoolResult>((resolve) => {
      const child = execFile(keytool, finalArgs, {
        timeout,
        env,
        cwd: options.cwd,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
      child.stderr?.on("data", (d) => (stderr += d.toString("utf8")));
      child.on("close", (code, signal) => {
        const exitCode = code ?? (signal ? -1 : 0);
        resolve({ stdout, stderr, exitCode });
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        const msg = err.code === "ETIMEDOUT" ? "ETIMEDOUT: keytool timed out" : err.message;
        resolve({ stdout: "", stderr: msg, exitCode: -1 });
      });
    });

    log.info("run", {
      args: finalArgs,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
      stderrHead: result.stderr.slice(0, 500)
    });
    return result;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    log.error("run failed", { args: finalArgs, durationMs: Date.now() - startedAt }, err);
    return { stdout: "", stderr: e.message ?? String(err), exitCode: -1 };
  }
}

// Combine stderr + stdout for error-mapper consumption. Keytool is famous for
// routing its "keytool error: ..." sentinel lines to stdout instead of stderr;
// any caller that wants to classify a failure must look at both streams.
function combineOutput(r: KeytoolResult): string {
  const parts = [r.stderr.trim(), r.stdout.trim()].filter(Boolean);
  return parts.join("\n");
}

// Parse `Alias name: xxx` lines from `keytool -list -rfc` output. The -rfc flag
// gives deterministic, machine-friendly output across Keytool versions.
export function parseAliasList(stdout: string): string[] {
  const aliases: string[] = [];
  const re = /^Alias name:\s*(.+?)\s*$/gmi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    aliases.push(m[1]);
  }
  return aliases;
}

// Parse per-alias blocks to extract both the alias and its Entry type. Keytool
// emits "Entry type: PrivateKeyEntry" / "trustedCertEntry" / "SecretKeyEntry"
// per alias; we normalize capitalisation for downstream type guards.
export function parseAliasEntries(stdout: string): AliasEntry[] {
  const entries: AliasEntry[] = [];
  // Split the output into per-alias chunks. The lookahead ensures each chunk
  // starts at its "Alias name:" header so "Entry type:" lines bind correctly.
  const chunks = stdout.split(/(?=^Alias name:)/m);
  for (const chunk of chunks) {
    const am = chunk.match(/^Alias name:\s*(.+?)\s*$/m);
    if (!am) continue;
    const em = chunk.match(/^Entry type:\s*(\S+)/mi);
    let entryType: AliasEntryType = "Unknown";
    if (em) {
      const raw = em[1];
      if (/privatekeyentry/i.test(raw)) entryType = "PrivateKeyEntry";
      else if (/trustedcertentry/i.test(raw)) entryType = "TrustedCertEntry";
      else if (/secretkeyentry/i.test(raw)) entryType = "SecretKeyEntry";
    }
    entries.push({ alias: am[1], entryType });
  }
  return entries;
}

export async function listAliases(
  keystore: string,
  password: string,
  storeType: KeystoreType
): Promise<string[]> {
  const args = [
    "-list", "-rfc",
    "-keystore", keystore,
    "-storetype", storeType,
    "-storepass:env", "STORE_PASSWORD"
  ];
  const r = await runKeytool(args, { env: { STORE_PASSWORD: password } });
  if (r.exitCode !== 0) {
    // keytool writes "keytool error: ..." lines to stdout (not stderr), so we
    // must include both streams in the error message — otherwise error-mapper
    // can't see the "password was incorrect" / "Invalid keystore format"
    // sentinels and falls back to a generic "list aliases failed".
    throw new Error(`keytool list failed (exit ${r.exitCode}): ${combineOutput(r)}`);
  }
  return parseAliasList(r.stdout);
}

// Same invocation as listAliases but returns structured {alias, entryType}.
// Callers that need to filter by entry type (e.g. JKS→P12 should only export
// PrivateKeyEntry aliases) use this; callers that just need names can keep
// using listAliases.
export async function listAliasEntries(
  keystore: string,
  password: string,
  storeType: KeystoreType
): Promise<AliasEntry[]> {
  const args = [
    "-list", "-rfc",
    "-keystore", keystore,
    "-storetype", storeType,
    "-storepass:env", "STORE_PASSWORD"
  ];
  const r = await runKeytool(args, { env: { STORE_PASSWORD: password } });
  if (r.exitCode !== 0) {
    throw new Error(`keytool list failed (exit ${r.exitCode}): ${combineOutput(r)}`);
  }
  return parseAliasEntries(r.stdout);
}
