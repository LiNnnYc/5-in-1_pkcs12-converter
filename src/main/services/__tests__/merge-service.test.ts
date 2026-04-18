import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import {
  mergePrecheck,
  mergePkcs12,
  computePrecheckToken,
  _internals
} from "../merge-service";
import { runOpenssl } from "../../engines/openssl-runner";
import { resolveOpensslPath } from "../../utils/path-resolver";
import type { MergeRequest } from "../../../types";

const HAS_OPENSSL = existsSync(resolveOpensslPath());
const d = HAS_OPENSSL ? describe : describe.skip;

// === Pure logic ===

describe("buildPkcs12Args", () => {
  it("AES-256-CBC includes aes-256-cbc + sha256 macalg", () => {
    const args = _internals.buildPkcs12Args({
      algorithm: "AES-256-CBC",
      keyPath: "/k.pem", certPath: "/c.pem", outputPath: "/o.pfx",
      hasKeyPassword: false
    });
    expect(args).toContain("-keypbe");
    expect(args).toContain("aes-256-cbc");
    expect(args).toContain("-macalg");
    expect(args).toContain("sha256");
    expect(args).not.toContain("-legacy");
    expect(args).not.toContain("-passin");
  });
  it("PBE-SHA1-3DES includes -legacy", () => {
    const args = _internals.buildPkcs12Args({
      algorithm: "PBE-SHA1-3DES",
      keyPath: "/k.pem", certPath: "/c.pem", outputPath: "/o.pfx",
      hasKeyPassword: false
    });
    expect(args).toContain("PBE-SHA1-3DES");
    expect(args).toContain("-legacy");
  });
  it("includes -passin env:KEY_PASSWORD when key is encrypted", () => {
    const args = _internals.buildPkcs12Args({
      algorithm: "AES-256-CBC",
      keyPath: "/k.pem", certPath: "/c.pem", outputPath: "/o.pfx",
      hasKeyPassword: true
    });
    expect(args).toContain("-passin");
    expect(args).toContain("env:KEY_PASSWORD");
  });
  it("includes -certfile when chainPemPath provided", () => {
    const args = _internals.buildPkcs12Args({
      algorithm: "AES-256-CBC",
      keyPath: "/k", certPath: "/c", chainPemPath: "/chain.pem",
      outputPath: "/o", hasKeyPassword: false
    });
    expect(args).toContain("-certfile");
    expect(args).toContain("/chain.pem");
  });
});

// === Integration with real openssl ===

d("merge-service integration", () => {
  let root: string, tmpRoot: string;
  let workDir: string;
  let keyPath: string, certPath: string, intPath: string, rootCaPath: string;
  let keyFp: string;

  beforeAll(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pkcs12-merge-"));
    workDir = join(tmpRoot, ".work");
    keyPath = join(tmpRoot, "srv.key");
    certPath = join(tmpRoot, "srv.pem");
    intPath = join(tmpRoot, "int.pem");
    rootCaPath = join(tmpRoot, "root.pem");
    root = tmpRoot;

    const rootKey = join(tmpRoot, "root.key");
    const intKey = join(tmpRoot, "int.key");
    const intCsr = join(tmpRoot, "int.csr");
    const srvCsr = join(tmpRoot, "srv.csr");
    const intExt = join(tmpRoot, "int.cnf");
    const srvExt = join(tmpRoot, "srv.cnf");
    writeFileSync(intExt,
      "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n");
    writeFileSync(srvExt,
      "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n");

    const run = async (args: string[]) => {
      const r = await runOpenssl(args);
      if (r.exitCode !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr}`);
    };

    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", rootKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", intKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", keyPath]);

    await run(["req", "-new", "-x509", "-key", rootKey, "-out", rootCaPath, "-days", "7",
      "-subj", "/CN=MergeTestRoot",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "subjectKeyIdentifier=hash"]);
    await run(["req", "-new", "-key", intKey, "-subj", "/CN=MergeTestInt", "-out", intCsr]);
    await run(["x509", "-req", "-in", intCsr, "-CA", rootCaPath, "-CAkey", rootKey,
      "-CAcreateserial", "-extfile", intExt, "-out", intPath, "-days", "7"]);
    await run(["req", "-new", "-key", keyPath, "-subj", "/CN=merge-server.test", "-out", srvCsr]);
    await run(["x509", "-req", "-in", srvCsr, "-CA", intPath, "-CAkey", intKey,
      "-CAcreateserial", "-extfile", srvExt, "-out", certPath, "-days", "7"]);

    keyFp = statSync(keyPath).mtimeMs.toString();
  }, 120_000);

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("precheck returns token + MergePrecheckResult and requires anchor confirmation", async () => {
    const res = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath, rootCaPath]
    }, workDir);
    expect(res.success).toBe(true);
    expect(res.details).toBeDefined();
    expect(res.details!.precheckToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.details!.keyMatchesCert).toBe(true);
    expect(res.details!.normalizedChainCerts.length).toBeGreaterThanOrEqual(1);
    // Root included -> expect CHAIN_HAS_ANCHOR warning
    const codes = (res.warnings ?? []).map((w) => w.code);
    expect(codes).toContain("CHAIN_HAS_ANCHOR");
  });

  it("precheck fails when key does not match cert", async () => {
    const otherKey = join(root, "other.key");
    await runOpenssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", otherKey]);
    const res = await mergePrecheck({
      privateKeyFile: otherKey,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    expect(res.success).toBe(false);
    expect(res.message).toBe("error.keyMismatch");
  });

  it("merge succeeds end-to-end with AES-256-CBC + produces loadable pfx + cleans .work", async () => {
    const pre = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    expect(pre.success).toBe(true);
    const outFile = join(root, "out-aes.pfx");
    const req: MergeRequest = {
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath],
      precheckToken: pre.details!.precheckToken,
      confirmedWarningCodes: (pre.warnings ?? []).filter(w => w.requiresConfirmation).map(w => w.code),
      exportPassword: "ExportPw123",
      algorithm: "AES-256-CBC",
      outputFile: outFile
    };
    const r = await mergePkcs12(req, workDir);
    expect(r.success, r.message).toBe(true);
    expect(existsSync(outFile)).toBe(true);
    // Verify pfx readable with password
    const verify = await runOpenssl([
      "pkcs12", "-in", outFile, "-nokeys", "-noout", "-passin", "env:PFX_PW"
    ], { env: { PFX_PW: "ExportPw123" } });
    expect(verify.exitCode, verify.stderr).toBe(0);
    // .work is removed after cleanup
    expect(existsSync(workDir)).toBe(false);
  }, 60_000);

  it("merge with PBE-SHA1-3DES succeeds (legacy provider)", async () => {
    const pre = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    const outFile = join(root, "out-legacy.pfx");
    const r = await mergePkcs12({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath],
      precheckToken: pre.details!.precheckToken,
      confirmedWarningCodes: (pre.warnings ?? []).filter(w => w.requiresConfirmation).map(w => w.code),
      exportPassword: "LegacyPw123",
      algorithm: "PBE-SHA1-3DES",
      outputFile: outFile
    }, workDir);
    expect(r.success, r.message).toBe(true);
    expect(existsSync(outFile)).toBe(true);
  }, 60_000);

  it("merge rejects stale precheck token", async () => {
    const pre = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    // Bump mtime of one file so the token no longer matches
    const future = new Date(Date.now() + 10_000);
    utimesSync(keyPath, future, future);
    const r = await mergePkcs12({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath],
      precheckToken: pre.details!.precheckToken,
      confirmedWarningCodes: (pre.warnings ?? []).filter(w => w.requiresConfirmation).map(w => w.code),
      exportPassword: "StalePw123",
      algorithm: "AES-256-CBC",
      outputFile: join(root, "stale.pfx")
    }, workDir);
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.staleToken");
  });

  it("merge rejects when required warnings not confirmed", async () => {
    const pre = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath, rootCaPath]
    }, workDir);
    const required = (pre.warnings ?? []).filter(w => w.requiresConfirmation).map(w => w.code);
    expect(required.length).toBeGreaterThan(0); // sanity: chain with root -> CHAIN_HAS_ANCHOR
    const r = await mergePkcs12({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath, rootCaPath],
      precheckToken: pre.details!.precheckToken,
      confirmedWarningCodes: [],
      exportPassword: "UnconfirmedPw",
      algorithm: "AES-256-CBC",
      outputFile: join(root, "unconfirmed.pfx")
    }, workDir);
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.unconfirmedWarnings");
  });

  it("computePrecheckToken is deterministic and differs when a file changes", () => {
    const t1 = computePrecheckToken([keyPath, certPath]);
    const t2 = computePrecheckToken([keyPath, certPath]);
    expect(t1).toBe(t2);
    const future = new Date(Date.now() + 20_000);
    utimesSync(certPath, future, future);
    const t3 = computePrecheckToken([keyPath, certPath]);
    expect(t3).not.toBe(t1);
  });
});
