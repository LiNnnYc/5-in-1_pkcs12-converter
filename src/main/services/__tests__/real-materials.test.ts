import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import { extractPkcs12 } from "../extract-service";
import { viewPkcs12 } from "../view-service";
import { mergePkcs12, mergePrecheck } from "../merge-service";
import { p12ToJks, jksToP12, listKeystoreAliases } from "../convert-service";
import { runKeytool, listAliases } from "../../engines/keytool-runner";
import { resolveOpensslPath, resolveKeytoolPath } from "../../utils/path-resolver";

// Materials live alongside the project root, not inside it — they're real
// production credentials and must not be checked in. Tests skip when the
// folder is missing so other developers' machines stay green.
const MATERIALS = resolve(process.cwd(), "..", "轉檔程式_測試範本");
const KEY = join(MATERIALS, "argus2025.key");
const CERT = join(MATERIALS, "CertB64.cer");
const CHAIN = join(MATERIALS, "CHT_NEW_IntermediateCert_Bundle.pem");
const PFX_AES = join(MATERIALS, "argus114.pfx");
const PFX_PBE = join(MATERIALS, "argus114_pbe.pfx");
const JKS = join(MATERIALS, "argus114.keystore");
const PASSWORD = "argus2025";

const HAS_MATERIALS =
  existsSync(KEY) && existsSync(CERT) && existsSync(CHAIN) &&
  existsSync(PFX_AES) && existsSync(PFX_PBE) && existsSync(JKS);
const HAS_OPENSSL = existsSync(resolveOpensslPath());
const HAS_KEYTOOL = existsSync(resolveKeytoolPath());

const d = HAS_MATERIALS && HAS_OPENSSL && HAS_KEYTOOL ? describe : describe.skip;

d("real-materials integration (轉檔程式_測試範本)", () => {
  let root: string;
  let workDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "pkcs12-real-"));
    workDir = join(root, ".work");
  });

  afterAll(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
  });

  // === View on real PFX ===

  it("views real CHT AES PFX (argus114.pfx)", async () => {
    const r = await viewPkcs12(
      { pfxFile: PFX_AES, pfxPassword: PASSWORD, legacyMode: "auto" },
      workDir
    );
    expect(r.success, r.message).toBe(true);
    expect(r.details!.privateKey?.algorithm).toBe("RSA");
    expect((r.details!.serverCert?.subject ?? "").length).toBeGreaterThan(0);
  }, 30_000);

  it("views real CHT legacy PBE PFX (argus114_pbe.pfx) via auto legacy", async () => {
    const r = await viewPkcs12(
      { pfxFile: PFX_PBE, pfxPassword: PASSWORD, legacyMode: "auto" },
      workDir
    );
    expect(r.success, r.message).toBe(true);
    expect(r.details!.privateKey).toBeTruthy();
  }, 30_000);

  // === Merge with real CHT chain ===

  it("merges real key + cert + CHT chain into AES PFX and round-trips through view", async () => {
    const out = join(root, "merged.pfx");
    const exportPw = "newpass1";
    const pre = await mergePrecheck(
      { privateKeyFile: KEY, serverCertFile: CERT, chainCertFiles: [CHAIN] },
      workDir
    );
    expect(pre.success, pre.message).toBe(true);
    const codes = (pre.warnings ?? []).filter((w) => w.requiresConfirmation).map((w) => w.code);
    const r = await mergePkcs12(
      {
        privateKeyFile: KEY,
        serverCertFile: CERT,
        chainCertFiles: [CHAIN],
        precheckToken: pre.details!.precheckToken,
        confirmedWarningCodes: codes,
        exportPassword: exportPw,
        algorithm: "AES-256-CBC",
        outputFile: out
      },
      workDir
    );
    expect(r.success, r.message).toBe(true);
    expect(existsSync(out)).toBe(true);

    const v = await viewPkcs12(
      { pfxFile: out, pfxPassword: exportPw, legacyMode: "auto" },
      workDir
    );
    expect(v.success, v.message).toBe(true);
    expect((v.details!.serverCert?.subject ?? "").toLowerCase()).toContain("cn=");
    expect(v.details!.chainCerts.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // === Long password (≥64 chars) end-to-end ===
  // Covers M3 manual test 8.0「超長密碼（64+ chars）能正常設定 + 讀取」

  it("supports an 84-char export password through merge → extract", async () => {
    const out = join(root, "longpass.pfx");
    const longPw = "Aa1!" + "x".repeat(80);
    expect(longPw.length).toBeGreaterThanOrEqual(64);

    const pre = await mergePrecheck(
      { privateKeyFile: KEY, serverCertFile: CERT, chainCertFiles: [CHAIN] },
      workDir
    );
    expect(pre.success).toBe(true);
    const codes = (pre.warnings ?? []).filter((w) => w.requiresConfirmation).map((w) => w.code);

    const r = await mergePkcs12(
      {
        privateKeyFile: KEY,
        serverCertFile: CERT,
        chainCertFiles: [CHAIN],
        precheckToken: pre.details!.precheckToken,
        confirmedWarningCodes: codes,
        exportPassword: longPw,
        algorithm: "AES-256-CBC",
        outputFile: out
      },
      workDir
    );
    expect(r.success, r.message).toBe(true);

    const outDir = join(root, "longpass-out");
    mkdirSync(outDir, { recursive: true });
    const e = await extractPkcs12(
      {
        pfxFile: out,
        pfxPassword: longPw,
        outputDir: outDir,
        certOutputMode: "merged",
        legacyMode: "auto"
      },
      workDir
    );
    expect(e.success, e.message).toBe(true);
    expect(existsSync(join(outDir, "private.key"))).toBe(true);
  }, 60_000);

  // === Legacy PFX → JKS via auto-repackage ===

  it("converts real legacy PBE PFX to JKS through auto-repackage", async () => {
    const out = join(root, "from-pbe.jks");
    const r = await p12ToJks({
      pfxFile: PFX_PBE,
      pfxPassword: PASSWORD,
      outputFile: out,
      outputPassword: "destpass1"
    });
    expect(r.success, r.message).toBe(true);
    expect(existsSync(out)).toBe(true);
    const aliases = await listAliases(out, "destpass1", "JKS");
    expect(aliases).toEqual(["1"]);
  }, 60_000);

  // === AES PFX → JKS direct ===

  it("converts real AES PFX to JKS directly", async () => {
    const out = join(root, "from-aes.jks");
    const r = await p12ToJks({
      pfxFile: PFX_AES,
      pfxPassword: PASSWORD,
      outputFile: out,
      outputPassword: "destpass2"
    });
    expect(r.success, r.message).toBe(true);
    expect(existsSync(out)).toBe(true);
  }, 60_000);

  // === Real JKS alias listing + conversion ===

  it("lists aliases on real JKS keystore (argus114.keystore)", async () => {
    const r = await listKeystoreAliases({
      keystoreFile: JKS,
      keystorePassword: PASSWORD,
      storeType: "JKS"
    });
    expect(r.success, r.message).toBe(true);
    expect(r.details!.aliases.length).toBeGreaterThan(0);
  }, 30_000);

  // === Chinese alias support ===
  // Covers M3 manual test 8.0「含中文 alias 的 keystore 能列出 + 選擇」

  it("handles Chinese alias through list + JKS→P12 conversion", async () => {
    const jks = join(root, "中文.jks");
    const out = join(root, "中文.p12");
    const alias = "中文別名";
    const storePw = "abc123";

    const gen = await runKeytool(
      [
        "-genkeypair",
        "-alias", alias,
        "-keyalg", "RSA", "-keysize", "2048", "-validity", "30",
        "-dname", "CN=ChineseAliasTest,O=Test,C=TW",
        "-keystore", jks, "-storetype", "JKS",
        "-storepass:env", "STORE_PASSWORD",
        "-keypass:env", "STORE_PASSWORD"
      ],
      { env: { STORE_PASSWORD: storePw } }
    );
    expect(gen.exitCode, `${gen.stderr}\n${gen.stdout}`).toBe(0);

    const list = await listKeystoreAliases({
      keystoreFile: jks, keystorePassword: storePw, storeType: "JKS"
    });
    expect(list.success, list.message).toBe(true);
    expect(list.details!.aliases.map((a) => a.alias)).toContain(alias);

    const conv = await jksToP12({
      jksFile: jks,
      jksPassword: storePw,
      outputFile: out,
      outputPassword: "abc456def",
      aliasFilter: alias
    });
    expect(conv.success, conv.message).toBe(true);
    expect(existsSync(out)).toBe(true);
  }, 60_000);
});
