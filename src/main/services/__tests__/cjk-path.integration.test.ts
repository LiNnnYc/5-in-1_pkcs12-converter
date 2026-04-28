import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import { extractPkcs12 } from "../extract-service";
import { viewPkcs12 } from "../view-service";
import { mergePkcs12, mergePrecheck } from "../merge-service";
import { jksToP12, p12ToJks, listKeystoreAliases } from "../convert-service";
import { checkKeyMatchesCert, runOpenssl } from "../../engines/openssl-runner";
import { runKeytool } from "../../engines/keytool-runner";
import { resolveOpensslPath, resolveKeytoolPath } from "../../utils/path-resolver";

// Regression suite for the OpenSSL 3.x non-ASCII path bug
// (`error:8000002A:Illegal byte sequence` from OSSL_STORE on Windows when the
// `-in <path>` arg contains CJK / emoji / any code point > 0x7f).
//
// Strategy: produce all fixtures in an ASCII tmpdir, then copy them into a
// directory whose name is full of non-ASCII (中文 + テスト + emoji), and run
// every public service against those CJK paths. Output paths are also CJK so
// the `withSafeOutputPath` rename round-trip is exercised end-to-end.

const HAS_OPENSSL = existsSync(resolveOpensslPath());
const HAS_KEYTOOL = existsSync(resolveKeytoolPath());
const d = HAS_OPENSSL && HAS_KEYTOOL ? describe : describe.skip;

const PASSWORD = "abc123XYZ";

d("cjk-path integration (non-ASCII source + output paths)", () => {
  let asciiRoot: string;
  let cjkRoot: string;
  let workDir: string;
  // Fixture paths (under cjkRoot, so file names contain non-ASCII too).
  let keyPath: string;
  let certPath: string;
  let intPath: string;
  let pfxPath: string;
  let jksPath: string;

  beforeAll(async () => {
    asciiRoot = mkdtempSync(join(tmpdir(), "cjk-fix-ascii-"));
    // Build the CJK directory under tmpdir() with a deliberately diverse mix
    // of non-ASCII code points: Chinese, Japanese kana, and a BMP emoji.
    cjkRoot = join(tmpdir(), `cjk-fix-中文_テスト_${Date.now()}`);
    mkdirSync(cjkRoot, { recursive: true });
    // workDir stays ASCII (matches production: exe lives at an ASCII path so
    // resolveWorkDir() is ASCII). The CJK paths under test are user-chosen
    // input / output, NOT the bundled work area.
    workDir = join(asciiRoot, ".work");

    const aRootKey = join(asciiRoot, "rk.pem");
    const aRootCert = join(asciiRoot, "rc.pem");
    const aIntKey = join(asciiRoot, "ik.pem");
    const aIntCert = join(asciiRoot, "ic.pem");
    const aIntCsr = join(asciiRoot, "ic.csr");
    const aSrvKey = join(asciiRoot, "sk.pem");
    const aSrvCert = join(asciiRoot, "sc.pem");
    const aSrvCsr = join(asciiRoot, "sc.csr");
    const aIntExt = join(asciiRoot, "ie.cnf");
    const aSrvExt = join(asciiRoot, "se.cnf");
    writeFileSync(aIntExt,
      "basicConstraints=critical,CA:TRUE,pathlen:0\n" +
      "keyUsage=critical,keyCertSign,cRLSign\n" +
      "subjectKeyIdentifier=hash\n" +
      "authorityKeyIdentifier=keyid:always\n");
    writeFileSync(aSrvExt,
      "basicConstraints=critical,CA:FALSE\n" +
      "subjectKeyIdentifier=hash\n" +
      "authorityKeyIdentifier=keyid,issuer\n");

    const ssl = async (args: string[]) => {
      const r = await runOpenssl(args);
      if (r.exitCode !== 0) throw new Error(`openssl: ${args.join(" ")}\n${r.stderr}`);
    };

    await ssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", aRootKey]);
    await ssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", aIntKey]);
    await ssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", aSrvKey]);

    await ssl(["req", "-new", "-x509", "-key", aRootKey, "-out", aRootCert, "-days", "7",
      "-subj", "/CN=CjkTestRoot",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "subjectKeyIdentifier=hash"]);
    await ssl(["req", "-new", "-key", aIntKey, "-subj", "/CN=CjkTestInt", "-out", aIntCsr]);
    await ssl(["x509", "-req", "-in", aIntCsr, "-CA", aRootCert, "-CAkey", aRootKey,
      "-CAcreateserial", "-extfile", aIntExt, "-out", aIntCert, "-days", "7"]);
    await ssl(["req", "-new", "-key", aSrvKey, "-subj", "/CN=cjk-server.test", "-out", aSrvCsr]);
    await ssl(["x509", "-req", "-in", aSrvCsr, "-CA", aIntCert, "-CAkey", aIntKey,
      "-CAcreateserial", "-extfile", aSrvExt, "-out", aSrvCert, "-days", "7"]);

    // Copy fixtures into CJK paths. File names also non-ASCII to exercise the
    // worst case (every path component contains code points > 0x7f).
    keyPath = join(cjkRoot, "私鑰.pem");
    certPath = join(cjkRoot, "伺服器憑證.pem");
    intPath = join(cjkRoot, "中繼憑證.pem");
    copyFileSync(aSrvKey, keyPath);
    copyFileSync(aSrvCert, certPath);
    copyFileSync(aIntCert, intPath);

    // Build a PFX at a CJK path for extract / view / p12ToJks tests.
    pfxPath = join(cjkRoot, "輸出_テスト.pfx");
    const pre = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    expect(pre.success, pre.message).toBe(true);
    const confirmed = (pre.warnings ?? []).filter(w => w.requiresConfirmation).map(w => w.code);
    const merge = await mergePkcs12({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath],
      precheckToken: pre.details!.precheckToken,
      confirmedWarningCodes: confirmed,
      exportPassword: PASSWORD,
      algorithm: "AES-256-CBC",
      outputFile: pfxPath
    }, workDir);
    expect(merge.success, merge.message).toBe(true);
    expect(existsSync(pfxPath)).toBe(true);

    // Build a JKS at an ASCII path (keytool can't always create files at CJK
    // paths even with sun.jnu.encoding=UTF-8 — depends on Windows codepage).
    // Production scenario: user receives keystore from elsewhere, places it in
    // their CJK folder, and our service must handle that read. So copy the
    // ASCII-built JKS into a CJK location for the actual test.
    const aJks = join(asciiRoot, "src.jks");
    const gen = await runKeytool([
      "-genkeypair",
      "-alias", "cjkalias",
      "-keyalg", "RSA", "-keysize", "2048", "-validity", "30",
      "-dname", "CN=CjkJksTest,O=Test,C=TW",
      "-keystore", aJks, "-storetype", "JKS",
      "-storepass:env", "STORE_PASSWORD",
      "-keypass:env", "STORE_PASSWORD"
    ], { env: { STORE_PASSWORD: PASSWORD } });
    expect(gen.exitCode, `${gen.stderr}\n${gen.stdout}`).toBe(0);
    jksPath = join(cjkRoot, "金鑰庫_中文.jks");
    copyFileSync(aJks, jksPath);
  }, 180_000);

  afterAll(() => {
    try { rmSync(cjkRoot, { recursive: true, force: true }); } catch { /* noop */ }
    try { rmSync(asciiRoot, { recursive: true, force: true }); } catch { /* noop */ }
  });

  // === The original bug: merge precheck with CJK key+cert paths must NOT
  // wrongly report key/cert mismatch. Before the fix it always returned
  // false (OpenSSL 3 OSSL_STORE failed to open the CJK paths). ===

  it("checkKeyMatchesCert returns true for matching key+cert at CJK paths", async () => {
    const ok = await checkKeyMatchesCert(keyPath, certPath);
    expect(ok).toBe(true);
  });

  it("merge precheck succeeds with CJK key + cert + chain paths", async () => {
    const r = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(r.details!.keyMatchesCert).toBe(true);
  });

  it("merge writes a PFX to a CJK output path", async () => {
    const out = join(cjkRoot, "合成輸出_🔐.pfx");
    const pre = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    expect(pre.success).toBe(true);
    const confirmed = (pre.warnings ?? []).filter(w => w.requiresConfirmation).map(w => w.code);
    const r = await mergePkcs12({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath],
      precheckToken: pre.details!.precheckToken,
      confirmedWarningCodes: confirmed,
      exportPassword: PASSWORD,
      algorithm: "AES-256-CBC",
      outputFile: out
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(existsSync(out)).toBe(true);
  });

  // === extract / view from CJK PFX ===

  it("extract reads a CJK PFX path and writes outputs to a CJK directory", async () => {
    const outDir = join(cjkRoot, "抽取輸出");
    mkdirSync(outDir, { recursive: true });
    const r = await extractPkcs12({
      pfxFile: pfxPath,
      pfxPassword: PASSWORD,
      outputDir: outDir,
      certOutputMode: "merged",
      legacyMode: "auto"
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(existsSync(join(outDir, "private.key"))).toBe(true);
    expect(existsSync(join(outDir, "certificates.pem"))).toBe(true);
  });

  it("view parses a CJK PFX path", async () => {
    const r = await viewPkcs12({
      pfxFile: pfxPath,
      pfxPassword: PASSWORD,
      legacyMode: "auto"
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(r.details?.serverCert?.subject ?? "").toContain("cjk-server.test");
  });

  // === keytool-side: JKS↔P12 with CJK paths ===

  it("listKeystoreAliases handles a CJK JKS path", async () => {
    const r = await listKeystoreAliases({
      keystoreFile: jksPath,
      keystorePassword: PASSWORD,
      storeType: "JKS"
    });
    expect(r.success, r.message).toBe(true);
    expect(r.details!.aliases.map((a) => a.alias)).toContain("cjkalias");
  });

  it("jksToP12 converts a CJK JKS to a CJK PFX path", async () => {
    const out = join(cjkRoot, "從JKS_轉_P12.pfx");
    const r = await jksToP12({
      jksFile: jksPath,
      jksPassword: PASSWORD,
      outputFile: out,
      outputPassword: PASSWORD,
      aliasFilter: "cjkalias"
    });
    expect(r.success, r.message).toBe(true);
    expect(existsSync(out)).toBe(true);
  });

  it("p12ToJks converts a CJK PFX to a CJK JKS path", async () => {
    const out = join(cjkRoot, "從P12_轉_JKS.jks");
    const r = await p12ToJks({
      pfxFile: pfxPath,
      pfxPassword: PASSWORD,
      outputFile: out,
      outputPassword: PASSWORD
    });
    expect(r.success, r.message).toBe(true);
    expect(existsSync(out)).toBe(true);
  });
});
