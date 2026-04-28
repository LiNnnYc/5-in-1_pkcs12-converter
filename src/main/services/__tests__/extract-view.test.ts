import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import { extractPkcs12 } from "../extract-service";
import { viewPkcs12 } from "../view-service";
import { mergePkcs12, mergePrecheck } from "../merge-service";
import { runOpenssl } from "../../engines/openssl-runner";
import { resolveOpensslPath } from "../../utils/path-resolver";

const HAS_OPENSSL = existsSync(resolveOpensslPath());
const d = HAS_OPENSSL ? describe : describe.skip;

d("extract-service + view-service integration", () => {
  let root: string;
  let workDir: string;
  let pfxAes: string;
  let pfxLegacy: string;
  let pfxBadPassword = "correct horse battery";
  let keyPath: string, certPath: string, intPath: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "pkcs12-ext-"));
    workDir = join(root, ".work");

    // Generate minimal chain (root + leaf) for quicker tests.
    keyPath = join(root, "k.pem");
    certPath = join(root, "c.pem");
    intPath = join(root, "int.pem");
    const rootKey = join(root, "rk.pem");
    const rootCert = join(root, "rc.pem");
    const intKey = join(root, "ik.pem");
    const intCsr = join(root, "ic.csr");
    const srvCsr = join(root, "sc.csr");
    const intExt = join(root, "ie.cnf");
    const srvExt = join(root, "se.cnf");
    writeFileSync(intExt,
      "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n");
    writeFileSync(srvExt,
      "basicConstraints=critical,CA:FALSE\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n");

    const run = async (args: string[]) => {
      const r = await runOpenssl(args);
      if (r.exitCode !== 0) throw new Error(`openssl: ${r.stderr}`);
    };

    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", rootKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", intKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", keyPath]);
    await run(["req", "-new", "-x509", "-key", rootKey, "-out", rootCert, "-days", "7",
      "-subj", "/CN=ExtractTestRoot",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "subjectKeyIdentifier=hash"]);
    await run(["req", "-new", "-key", intKey, "-subj", "/CN=ExtractTestInt", "-out", intCsr]);
    await run(["x509", "-req", "-in", intCsr, "-CA", rootCert, "-CAkey", rootKey,
      "-CAcreateserial", "-extfile", intExt, "-out", intPath, "-days", "7"]);
    await run(["req", "-new", "-key", keyPath, "-subj", "/CN=extract-server.test", "-out", srvCsr]);
    await run(["x509", "-req", "-in", srvCsr, "-CA", intPath, "-CAkey", intKey,
      "-CAcreateserial", "-extfile", srvExt, "-out", certPath, "-days", "7"]);

    // Build two pfx files: modern (AES-256-CBC) and legacy (PBE-SHA1-3DES)
    const doMerge = async (algo: "AES-256-CBC" | "PBE-SHA1-3DES", outFile: string) => {
      const pre = await mergePrecheck({
        privateKeyFile: keyPath,
        serverCertFile: certPath,
        chainCertFiles: [intPath]
      }, workDir);
      expect(pre.success, pre.message).toBe(true);
      const confirmed = (pre.warnings ?? []).filter(w => w.requiresConfirmation).map(w => w.code);
      const r = await mergePkcs12({
        privateKeyFile: keyPath,
        serverCertFile: certPath,
        chainCertFiles: [intPath],
        precheckToken: pre.details!.precheckToken,
        confirmedWarningCodes: confirmed,
        exportPassword: pfxBadPassword,
        algorithm: algo,
        outputFile: outFile
      }, workDir);
      expect(r.success, r.message).toBe(true);
    };

    pfxAes = join(root, "aes.pfx");
    pfxLegacy = join(root, "legacy.pfx");
    await doMerge("AES-256-CBC", pfxAes);
    await doMerge("PBE-SHA1-3DES", pfxLegacy);
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // === extract ===

  it("extract merged mode writes private.key + certificates.pem", async () => {
    const outDir = join(root, "out-merged");
    mkdtempLike(outDir);
    const r = await extractPkcs12({
      pfxFile: pfxAes,
      pfxPassword: pfxBadPassword,
      outputDir: outDir,
      certOutputMode: "merged",
      legacyMode: "auto"
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(existsSync(join(outDir, "private.key"))).toBe(true);
    expect(existsSync(join(outDir, "certificates.pem"))).toBe(true);
    const pem = readFileSync(join(outDir, "certificates.pem"), "utf8");
    expect(pem.match(/-----BEGIN CERTIFICATE-----/g)?.length).toBeGreaterThanOrEqual(2);
    expect(existsSync(workDir)).toBe(false);
  });

  it("extract split mode names certs by CN", async () => {
    const outDir = join(root, "out-split");
    mkdtempLike(outDir);
    const r = await extractPkcs12({
      pfxFile: pfxAes,
      pfxPassword: pfxBadPassword,
      outputDir: outDir,
      certOutputMode: "split",
      legacyMode: "auto"
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(existsSync(join(outDir, "private.key"))).toBe(true);
    expect(existsSync(join(outDir, "extract-server.test.crt"))).toBe(true);
    expect(existsSync(join(outDir, "ExtractTestInt.crt"))).toBe(true);
  });

  it("extract auto-detects legacy pfx and retries with -legacy", async () => {
    const outDir = join(root, "out-legacy-auto");
    mkdtempLike(outDir);
    const r = await extractPkcs12({
      pfxFile: pfxLegacy,
      pfxPassword: pfxBadPassword,
      outputDir: outDir,
      certOutputMode: "merged",
      legacyMode: "auto"
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(existsSync(join(outDir, "private.key"))).toBe(true);
  });

  it("extract rejects wrong password with password error", async () => {
    const outDir = join(root, "out-bad-pw");
    mkdtempLike(outDir);
    const r = await extractPkcs12({
      pfxFile: pfxAes,
      pfxPassword: "wrong",
      outputDir: outDir,
      certOutputMode: "merged",
      legacyMode: "auto"
    }, workDir);
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.passwordIncorrect");
  });

  it("extract on non-PFX file returns error.formatInvalid (not opensslFailed)", async () => {
    // Regression for M3 manual-test #6: feeding a non-PFX file to extract used
    // to surface error.opensslFailed plus a LEGACY_MODE_UNCERTAIN warning.
    // probeLegacy now classifies clear format errors and short-circuits to
    // error.formatInvalid so the UI shows "檔案格式無效" directly.
    const garbage = join(root, "garbage.pfx");
    writeFileSync(garbage, "this is definitely not a pfx\n".repeat(10));
    const outDir = join(root, "out-garbage");
    mkdtempLike(outDir);
    const r = await extractPkcs12({
      pfxFile: garbage,
      pfxPassword: "whatever",
      outputDir: outDir,
      certOutputMode: "merged",
      legacyMode: "auto"
    }, workDir);
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.formatInvalid");
  });

  // === view ===

  it("view returns structured result for AES pfx", async () => {
    const r = await viewPkcs12({
      pfxFile: pfxAes,
      pfxPassword: pfxBadPassword,
      legacyMode: "auto"
    }, workDir);
    expect(r.success, r.message).toBe(true);
    const info = r.details!;
    expect(info.privateKey?.algorithm).toBe("RSA");
    expect(info.privateKey?.keySize).toBe(2048);
    expect(info.serverCert?.subject).toContain("extract-server.test");
    expect(info.chainCerts.length).toBeGreaterThanOrEqual(1);
    const chainSubjects = info.chainCerts.map((c) => c.subject).join("|");
    expect(chainSubjects).toContain("ExtractTestInt");
  });

  it("view auto-handles legacy pfx", async () => {
    const r = await viewPkcs12({
      pfxFile: pfxLegacy,
      pfxPassword: pfxBadPassword,
      legacyMode: "auto"
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(r.details!.privateKey?.algorithm).toBe("RSA");
  });

  it("view reports password error on wrong pw", async () => {
    const r = await viewPkcs12({
      pfxFile: pfxAes,
      pfxPassword: "nope"
    }, workDir);
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.passwordIncorrect");
  });
});

// small helper — ensures dir exists & empty for each extract case
import { mkdirSync, rmSync as _rm } from "node:fs";
function mkdtempLike(dir: string) {
  try { _rm(dir, { recursive: true, force: true }); } catch {}
  mkdirSync(dir, { recursive: true });
}
