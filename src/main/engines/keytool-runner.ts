import { execFile } from "node:child_process";
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
  //  - user.language=en + user.country=US forces English output so stdout
  //    regexes ("Alias name:", "Warning:", error sentinels) match regardless
  //    of the user's system locale. Portable app must not drift by locale.
  const finalArgs = [
    "-J-Dfile.encoding=UTF-8",
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
    // Caller's responsibility to distinguish wrong password vs. corrupt file
    // via error-mapper; we surface a concise error so tests/services get a
    // structured signal.
    throw new Error(`keytool list failed (exit ${r.exitCode}): ${r.stderr.trim().split("\n").slice(-2).join(" | ")}`);
  }
  return parseAliasList(r.stdout);
}
