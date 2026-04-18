import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// M1 + M2 end-to-end: openssl-produced key/cert -> M1 merge -> .pfx
// -> M2 p12ToJks -> .jks -> M2 jksToP12 -> final .p12 -> keytool listAliases.

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import { mergePrecheck, mergePkcs12 } from "../../src/main/services/merge-service";
import { jksToP12, p12ToJks } from "../../src/main/services/convert-service";
import { runOpenssl } from "../../src/main/engines/openssl-runner";
import { listAliases } from "../../src/main/engines/keytool-runner";
import { resolveKeytoolPath, resolveOpensslPath } from "../../src/main/utils/path-resolver";

const HAS_BOTH = existsSync(resolveKeytoolPath()) && existsSync(resolveOpensslPath());
const d = HAS_BOTH ? describe : describe.skip;

d("M1 + M2 roundtrip (merge -> p12->jks -> jks->p12)", () => {
  let root: string;
  let workDir: string;
  let keyPath: string, certPath: string, intPath: string, rootCaPath: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "pkcs12-roundtrip-"));
    workDir = join(root, ".work");
    const intExt = join(root, "int.cnf");
    const srvExt = join(root, "srv.cnf");
    writeFileSync(intExt,
      "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n");
    writeFileSync(srvExt,
      "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n");

    keyPath = join(root, "srv.key");
    certPath = join(root, "srv.pem");
    intPath = join(root, "int.pem");
    rootCaPath = join(root, "root.pem");
    const rootKey = join(root, "root.key");
    const intKey = join(root, "int.key");
    const intCsr = join(root, "int.csr");
    const srvCsr = join(root, "srv.csr");

    const run = async (args: string[]) => {
      const r = await runOpenssl(args);
      if (r.exitCode !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr}`);
    };

    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", rootKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", intKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", keyPath]);

    await run(["req", "-new", "-x509", "-key", rootKey, "-out", rootCaPath, "-days", "7",
      "-subj", "/CN=RoundtripRoot",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "subjectKeyIdentifier=hash"]);
    await run(["req", "-new", "-key", intKey, "-subj", "/CN=RoundtripInt", "-out", intCsr]);
    await run(["x509", "-req", "-in", intCsr, "-CA", rootCaPath, "-CAkey", rootKey,
      "-CAcreateserial", "-extfile", intExt, "-out", intPath, "-days", "7"]);
    await run(["req", "-new", "-key", keyPath, "-subj", "/CN=roundtrip.test", "-out", srvCsr]);
    await run(["x509", "-req", "-in", srvCsr, "-CA", intPath, "-CAkey", intKey,
      "-CAcreateserial", "-extfile", srvExt, "-out", certPath, "-days", "7"]);
  }, 120_000);

  afterAll(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("merged .pfx -> .jks -> .p12 and final keystore carries alias '1'", async () => {
    // Step 1: M1 merge
    const pre = await mergePrecheck({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath]
    }, workDir);
    expect(pre.success).toBe(true);

    const mergedPfx = join(root, "merged.pfx");
    const mergeRes = await mergePkcs12({
      privateKeyFile: keyPath,
      serverCertFile: certPath,
      chainCertFiles: [intPath],
      precheckToken: pre.details!.precheckToken,
      confirmedWarningCodes: (pre.warnings ?? [])
        .filter((w) => w.requiresConfirmation)
        .map((w) => w.code),
      exportPassword: "MergePw123",
      algorithm: "AES-256-CBC",
      outputFile: mergedPfx
    }, workDir);
    expect(mergeRes.success).toBe(true);
    expect(existsSync(mergedPfx)).toBe(true);

    // Step 2: M2 p12ToJks (pfx -> jks, dest alias fixed to "1")
    const jksMid = join(root, "mid.jks");
    const toJksRes = await p12ToJks({
      pfxFile: mergedPfx,
      pfxPassword: "MergePw123",
      outputFile: jksMid,
      outputPassword: "JksPw123"
    });
    expect(toJksRes.success).toBe(true);
    expect(existsSync(jksMid)).toBe(true);
    const midAliases = await listAliases(jksMid, "JksPw123", "JKS");
    expect(midAliases.map((a) => a.toLowerCase())).toContain("1");

    // Step 3: M2 jksToP12 (jks -> final p12)
    const finalP12 = join(root, "final.p12");
    const toP12Res = await jksToP12({
      jksFile: jksMid,
      jksPassword: "JksPw123",
      outputFile: finalP12,
      outputPassword: "FinalPw123"
    });
    expect(toP12Res.success).toBe(true);
    expect(existsSync(finalP12)).toBe(true);

    // Step 4: keytool reads final p12 back
    const finalAliases = await listAliases(finalP12, "FinalPw123", "PKCS12");
    expect(finalAliases.length).toBe(1);
    expect(finalAliases[0].toLowerCase()).toBe("1");
  }, 60_000);
});
