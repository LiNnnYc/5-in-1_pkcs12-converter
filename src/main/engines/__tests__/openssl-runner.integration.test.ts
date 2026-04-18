import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Stub out electron's `app` so path-resolver works outside the Electron runtime.
// Must be declared before importing modules that transitively pull electron in.
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => ""
  }
}));

import {
  runOpenssl,
  detectFormat,
  parseKeyInfo,
  checkKeyMatchesCert,
  convertDerToPem,
  parseCertificateText
} from "../openssl-runner";
import { parseCertInfo, parsePrivateKeyInfo } from "../output-parser";
import { resolveOpensslPath } from "../../utils/path-resolver";

const OPENSSL = resolveOpensslPath();
const HAS_OPENSSL = existsSync(OPENSSL);

let workDir: string;
let keyPath: string;
let certPath: string;
let otherKeyPath: string;
let derPath: string;
let convertedPemPath: string;

// Skip entire suite if the bundled openssl isn't present (CI without engines/).
const d = HAS_OPENSSL ? describe : describe.skip;

d("openssl-runner integration (real openssl.exe)", () => {
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "pkcs12-int-"));
    keyPath = join(workDir, "key.pem");
    certPath = join(workDir, "cert.pem");
    otherKeyPath = join(workDir, "other.pem");
    derPath = join(workDir, "cert.der");
    convertedPemPath = join(workDir, "converted.pem");

    // Generate RSA 2048 private key
    const keyRes = await runOpenssl([
      "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
      "-out", keyPath
    ]);
    expect(keyRes.exitCode, keyRes.stderr).toBe(0);

    // Self-signed cert — passing /CN=... as a single argv element via execFile,
    // so MSYS/Git-Bash path conversion does not apply.
    const certRes = await runOpenssl([
      "req", "-new", "-x509", "-key", keyPath, "-out", certPath,
      "-days", "7", "-subj", "/CN=integration.test/O=PKCS12Converter"
    ]);
    expect(certRes.exitCode, certRes.stderr).toBe(0);

    // A second unrelated key (for negative match test)
    const otherRes = await runOpenssl([
      "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
      "-out", otherKeyPath
    ]);
    expect(otherRes.exitCode, otherRes.stderr).toBe(0);

    // Produce a DER version of the cert for format-detection test
    const derRes = await runOpenssl([
      "x509", "-in", certPath, "-outform", "DER", "-out", derPath
    ]);
    expect(derRes.exitCode, derRes.stderr).toBe(0);
  }, 60_000);

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("runOpenssl returns version string", async () => {
    const r = await runOpenssl(["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/OpenSSL\s+3\./);
  });

  it("loads legacy provider via OPENSSL_MODULES env", async () => {
    const r = await runOpenssl(["list", "-providers", "-provider", "legacy"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/legacy/i);
    expect(r.stdout).toMatch(/status:\s*active/i);
  });

  it("detectFormat distinguishes PEM and DER", async () => {
    expect(await detectFormat(certPath)).toBe("PEM");
    expect(await detectFormat(derPath)).toBe("DER");
  });

  it("convertDerToPem produces a loadable PEM", async () => {
    const r = await convertDerToPem(derPath, convertedPemPath);
    expect(r.exitCode, r.stderr).toBe(0);
    const pem = readFileSync(convertedPemPath, "utf8");
    expect(pem).toContain("-----BEGIN CERTIFICATE-----");
  });

  it("parseCertificateText + parseCertInfo yield structured cert info", async () => {
    const r = await parseCertificateText(certPath);
    expect(r.exitCode, r.stderr).toBe(0);
    const info = parseCertInfo(r.stdout);
    expect(info.subject).toContain("CN=integration.test");
    expect(info.issuer).toContain("CN=integration.test");
    expect(info.signatureAlgorithm).toMatch(/sha256|rsa/i);
    expect(info.fingerprint.sha256).toMatch(/^[0-9A-F:]{64,}$/);
  });

  it("parseKeyInfo identifies RSA 2048", async () => {
    const r = await parseKeyInfo(keyPath);
    expect(r.exitCode, r.stderr).toBe(0);
    const info = parsePrivateKeyInfo(r.stdout);
    expect(info.algorithm).toBe("RSA");
    expect(info.keySize).toBe(2048);
    expect(info.encrypted).toBe(false);
  });

  it("checkKeyMatchesCert: positive match", async () => {
    const ok = await checkKeyMatchesCert(keyPath, certPath);
    expect(ok).toBe(true);
  });

  it("checkKeyMatchesCert: negative match with unrelated key", async () => {
    const ok = await checkKeyMatchesCert(otherKeyPath, certPath);
    expect(ok).toBe(false);
  });

  it("runOpenssl timeout returns non-zero exit without hanging", async () => {
    // `openssl speed` is long-running; we force a 500ms timeout to exercise timeout path.
    const r = await runOpenssl(["speed", "-seconds", "30", "rsa2048"], { timeoutMs: 500 });
    expect(r.exitCode).not.toBe(0);
  }, 10_000);

  it("does not leak PASSWORD env from parent process", async () => {
    // Set a fake password env var; runner should filter it before spawning.
    const prev = process.env.EXPORT_PASSWORD;
    process.env.EXPORT_PASSWORD = "should-not-leak";
    try {
      // Ask openssl to print its environment-based passphrase. Using `genpkey`
      // with `-pass env:EXPORT_PASSWORD` would encrypt; since runner strips
      // parent's EXPORT_PASSWORD, openssl will fail reading that env.
      const r = await runOpenssl([
        "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:1024",
        "-aes-256-cbc", "-pass", "env:EXPORT_PASSWORD",
        "-out", join(workDir, "enc.pem")
      ]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/env|password|pass/i);
    } finally {
      if (prev === undefined) delete process.env.EXPORT_PASSWORD;
      else process.env.EXPORT_PASSWORD = prev;
    }
  });
});

if (!HAS_OPENSSL) {
  // Sanity log so CI reports clearly if engines are missing.
  // eslint-disable-next-line no-console
  console.warn(`[integration] Skipping openssl integration tests — ${OPENSSL} not found`);
}
