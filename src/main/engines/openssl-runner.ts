import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, readFile } from "node:fs/promises";
import { resolveOpensslPath, resolveOpensslModulesDir } from "../utils/path-resolver";
import { createHash } from "node:crypto";
import { createLogger } from "../utils/logger";

const log = createLogger("openssl");

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 40_000;

export type OpenSslResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunOpenSslOptions = {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  cwd?: string;
};

// execFile wrapper — returns stdout/stderr/exitCode without throwing on non-zero exit.
// Password is passed via env (EXPORT_PASSWORD / KEY_PASSWORD / PFX_PASSWORD) per spec.md §7.
export async function runOpenssl(
  args: string[],
  options: RunOpenSslOptions = {}
): Promise<OpenSslResult> {
  const openssl = resolveOpensslPath();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Merge parent env with supplied env so PATH etc. remain available. Start from a clean
  // filtered copy (drop any *_PASSWORD leakage that isn't being injected deliberately).
  const baseEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/PASSWORD/i.test(k)) continue;
    baseEnv[k] = v;
  }
  // Pin OpenSSL to the bundled modules dir (so `-legacy` can load legacy.dll) and
  // suppress any hard-coded openssl.cnf lookup ("C:\Program Files\Common Files\SSL\...")
  // baked into the binary at build time. Spec.md §5 portable constraint.
  baseEnv.OPENSSL_MODULES = resolveOpensslModulesDir();
  baseEnv.OPENSSL_CONF = "";
  const env = { ...baseEnv, ...(options.env ?? {}) };

  const startedAt = Date.now();
  try {
    const child = execFile(openssl, args, {
      timeout,
      env,
      cwd: options.cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    if (options.stdin !== undefined && child.stdin) {
      child.stdin.end(options.stdin);
    }
    const result = await new Promise<OpenSslResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
      child.stderr?.on("data", (d) => (stderr += d.toString("utf8")));
      child.on("close", (code, signal) => {
        const exitCode = code ?? (signal ? -1 : 0);
        resolve({ stdout, stderr, exitCode });
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        const msg = err.code === "ETIMEDOUT" ? "ETIMEDOUT: openssl timed out" : err.message;
        resolve({ stdout: "", stderr: msg, exitCode: -1 });
      });
    });
    log.info("run", {
      args,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
      stderrHead: result.stderr.slice(0, 500)
    });
    return result;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    log.error("run failed", { args, durationMs: Date.now() - startedAt }, err);
    return { stdout: "", stderr: e.message ?? String(err), exitCode: -1 };
  }
}

// === Format detection ===

export type CertFormat = "PEM" | "DER";

// Detect PEM (ASCII "-----BEGIN") vs DER (binary) from file header.
export async function detectFormat(filePath: string): Promise<CertFormat> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(32);
    await fh.read(buf, 0, 32, 0);
    const asText = buf.toString("utf8");
    return asText.includes("-----BEGIN") ? "PEM" : "DER";
  } finally {
    await fh.close();
  }
}

// === High-level helpers ===

export async function parseCertificateText(pemPath: string): Promise<OpenSslResult> {
  return runOpenssl(["x509", "-text", "-noout", "-fingerprint", "-sha256", "-in", pemPath]);
}

export async function parseCertificateFingerprints(pemPath: string): Promise<{ sha1: string; sha256: string }> {
  const [r1, r256] = await Promise.all([
    runOpenssl(["x509", "-noout", "-fingerprint", "-sha1", "-in", pemPath]),
    runOpenssl(["x509", "-noout", "-fingerprint", "-sha256", "-in", pemPath])
  ]);
  const sha1 = r1.stdout.match(/sha1 Fingerprint=([0-9A-Fa-f:]+)/i)?.[1] ?? "";
  const sha256 = r256.stdout.match(/sha256 Fingerprint=([0-9A-Fa-f:]+)/i)?.[1] ?? "";
  return { sha1, sha256 };
}

export async function parseKeyInfo(keyPath: string, password?: string): Promise<OpenSslResult> {
  // Try pkey first (works for RSA/EC/Ed25519 regardless of format).
  const env: NodeJS.ProcessEnv = password ? { KEY_PASSWORD: password } : {};
  const args = ["pkey", "-text", "-noout", "-in", keyPath];
  if (password) args.splice(args.length, 0, "-passin", "env:KEY_PASSWORD");
  return runOpenssl(args, { env });
}

// Compare modulus / public key hash of key vs cert. Works for RSA and EC.
export async function checkKeyMatchesCert(keyPath: string, certPath: string, keyPassword?: string): Promise<boolean> {
  const env: NodeJS.ProcessEnv = keyPassword ? { KEY_PASSWORD: keyPassword } : {};
  const passin = keyPassword ? ["-passin", "env:KEY_PASSWORD"] : [];

  const [keyOut, certOut] = await Promise.all([
    runOpenssl(["pkey", "-pubout", "-in", keyPath, ...passin], { env }),
    runOpenssl(["x509", "-pubkey", "-noout", "-in", certPath])
  ]);

  if (keyOut.exitCode !== 0 || certOut.exitCode !== 0) return false;

  const keyHash = createHash("sha256").update(normalizePem(keyOut.stdout)).digest("hex");
  const certHash = createHash("sha256").update(normalizePem(certOut.stdout)).digest("hex");
  return keyHash === certHash && keyHash.length > 0;
}

function normalizePem(pem: string): string {
  return pem.replace(/\r\n/g, "\n").trim();
}

export async function convertDerToPem(derPath: string, outPath: string): Promise<OpenSslResult> {
  return runOpenssl(["x509", "-inform", "DER", "-outform", "PEM", "-in", derPath, "-out", outPath]);
}

export async function readPem(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return buf.toString("utf8");
}
