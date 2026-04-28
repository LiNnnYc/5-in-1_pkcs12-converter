import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, readFile, writeFile, unlink } from "node:fs/promises";
import { resolveOpensslPath, resolveOpensslModulesDir } from "../utils/path-resolver";
import { createHash } from "node:crypto";
import { createLogger } from "../utils/logger";
import { readFileForOpenssl } from "../utils/safe-path";

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
  stdin?: string | Buffer;
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
  // Pipe content via stdin instead of `-in <path>` to avoid OpenSSL 3.x's OSSL_STORE
  // failure on Windows for non-ASCII paths (CJK, emoji, etc.).
  const buf = await readFileForOpenssl(keyPath);
  const env: NodeJS.ProcessEnv = password ? { KEY_PASSWORD: password } : {};
  const args = ["pkey", "-text", "-noout"];
  if (password) args.push("-passin", "env:KEY_PASSWORD");
  return runOpenssl(args, { env, stdin: buf });
}

// Compare modulus / public key hash of key vs cert. Works for RSA and EC.
// Both inputs are piped via stdin to dodge OpenSSL 3.x's non-ASCII path bug.
export async function checkKeyMatchesCert(keyPath: string, certPath: string, keyPassword?: string): Promise<boolean> {
  const env: NodeJS.ProcessEnv = keyPassword ? { KEY_PASSWORD: keyPassword } : {};
  const passin = keyPassword ? ["-passin", "env:KEY_PASSWORD"] : [];
  const [keyBuf, certBuf] = await Promise.all([
    readFileForOpenssl(keyPath),
    readFileForOpenssl(certPath)
  ]);

  const [keyOut, certOut] = await Promise.all([
    runOpenssl(["pkey", "-pubout", ...passin], { env, stdin: keyBuf }),
    runOpenssl(["x509", "-pubkey", "-noout"], { stdin: certBuf })
  ]);

  if (keyOut.exitCode !== 0 || certOut.exitCode !== 0) return false;

  const keyHash = createHash("sha256").update(normalizePem(keyOut.stdout)).digest("hex");
  const certHash = createHash("sha256").update(normalizePem(certOut.stdout)).digest("hex");
  return keyHash === certHash && keyHash.length > 0;
}

function normalizePem(pem: string): string {
  return pem.replace(/\r\n/g, "\n").trim();
}

// SHA-256 over SubjectPublicKeyInfo DER, formatted as colon-separated uppercase hex.
// Matches the "public key fingerprint" shown by tools like `ssh-keygen -l -f pubkey.pem`
// in terms of representing the pubkey identity (though ssh-keygen emits base64/SHA-256:...).
// Callers should pass a PEM blob with SPKI ("-----BEGIN PUBLIC KEY-----...").
function spkiSha256Fingerprint(pubkeyPem: string): string {
  const body = pubkeyPem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) return "";
  const der = Buffer.from(body, "base64");
  const hex = createHash("sha256").update(der).digest("hex").toUpperCase();
  return hex.match(/.{2}/g)?.join(":") ?? "";
}

export async function publicKeyFingerprintFromKey(
  keyPath: string,
  password?: string
): Promise<string> {
  const buf = await readFileForOpenssl(keyPath);
  const env: NodeJS.ProcessEnv = password ? { KEY_PASSWORD: password } : {};
  const passin = password ? ["-passin", "env:KEY_PASSWORD"] : [];
  const r = await runOpenssl(["pkey", "-pubout", ...passin], { env, stdin: buf });
  if (r.exitCode !== 0) return "";
  return spkiSha256Fingerprint(r.stdout);
}

export async function publicKeyFingerprintFromCert(certPath: string): Promise<string> {
  const buf = await readFileForOpenssl(certPath);
  const r = await runOpenssl(["x509", "-pubkey", "-noout"], { stdin: buf });
  if (r.exitCode !== 0) return "";
  return spkiSha256Fingerprint(r.stdout);
}

// Dump PKCS#12 structural metadata (MAC, bag encryption, friendlyName, localKeyID).
// Uses -noout -nokeys -nocerts so no PEM content is emitted — just the header/bag
// annotations that `openssl pkcs12 -info` prints above each bag.
export async function dumpPkcs12Info(
  pfxPath: string,
  password: string,
  legacy: boolean
): Promise<OpenSslResult> {
  const buf = await readFileForOpenssl(pfxPath);
  const args = [
    "pkcs12", "-info", "-noout", "-nokeys", "-nocerts",
    "-passin", "env:PFX_PASSWORD"
  ];
  if (legacy) args.push("-legacy");
  return runOpenssl(args, { env: { PFX_PASSWORD: password }, stdin: buf });
}

export async function convertDerToPem(derPath: string, outPath: string): Promise<OpenSslResult> {
  // DER is binary; piping via stdin on Windows hits CRT text-mode CRLF
  // translation and breaks parsing ("Could not find certificate from <stdin>").
  // Stage the DER bytes into a sibling ASCII file next to outPath (which is
  // always under .work/), then point `-in` at that staged copy. Avoids both
  // the non-ASCII path bug and the stdin binary-mode bug at once.
  const buf = await readFileForOpenssl(derPath);
  const stagedDer = `${outPath}.in.der`;
  await writeFile(stagedDer, buf);
  try {
    return await runOpenssl(["x509", "-inform", "DER", "-outform", "PEM", "-in", stagedDer, "-out", outPath]);
  } finally {
    // Best-effort cleanup; .work/ teardown will catch any miss.
    await unlink(stagedDer).catch(() => undefined);
  }
}

export async function readPem(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return buf.toString("utf8");
}
