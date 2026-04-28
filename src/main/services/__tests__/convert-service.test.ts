import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import { jksToP12, p12ToJks, listKeystoreAliases } from "../convert-service";
import { runKeytool, listAliases } from "../../engines/keytool-runner";
import { resolveKeytoolPath, resolveOpensslPath } from "../../utils/path-resolver";

const HAS_KEYTOOL = existsSync(resolveKeytoolPath());
const HAS_OPENSSL = existsSync(resolveOpensslPath());
const d = HAS_KEYTOOL && HAS_OPENSSL ? describe : describe.skip;

async function genJks(path: string, alias: string, password: string): Promise<void> {
  const r = await runKeytool([
    "-genkeypair",
    "-alias", alias,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "30",
    "-dname", `CN=${alias},O=Test,C=TW`,
    "-keystore", path,
    "-storetype", "JKS",
    "-storepass:env", "STORE_PASSWORD",
    "-keypass:env", "STORE_PASSWORD"
  ], { env: { STORE_PASSWORD: password } });
  if (r.exitCode !== 0) throw new Error(`genkeypair failed (exit ${r.exitCode}): stderr=${r.stderr} stdout=${r.stdout}`);
}

d("convert-service integration (keytool + openssl)", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "pkcs12-convert-"));
  });

  afterAll(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("JKS→P12 succeeds for a single-alias JKS and produces an openssl-verifiable P12", async () => {
    const jks = join(root, "single.jks");
    const out = join(root, "single.p12");
    await genJks(jks, "onlyone", "srcpass");

    const r = await jksToP12({
      jksFile: jks,
      jksPassword: "srcpass",
      outputFile: out,
      outputPassword: "destpass"
    });
    expect(r.success).toBe(true);
    expect(r.outputFiles).toEqual([out]);
    expect(existsSync(out)).toBe(true);

    const aliases = await listAliases(out, "destpass", "PKCS12");
    expect(aliases.length).toBe(1);
  });

  it("JKS→P12 with multiple aliases and no aliasFilter surfaces JKS_MULTIPLE_ALIASES warning", async () => {
    const jks = join(root, "multi.jks");
    const out = join(root, "multi.p12");
    await genJks(jks, "alpha", "srcpass");
    // add second alias
    const r2 = await runKeytool([
      "-genkeypair",
      "-alias", "beta",
      "-keyalg", "RSA",
      "-keysize", "2048",
      "-validity", "30",
      "-dname", "CN=beta,O=Test,C=TW",
      "-keystore", jks,
      "-storetype", "JKS",
      "-storepass:env", "STORE_PASSWORD",
      "-keypass:env", "STORE_PASSWORD"
    ], { env: { STORE_PASSWORD: "srcpass" } });
    expect(r2.exitCode).toBe(0);

    const r = await jksToP12({
      jksFile: jks,
      jksPassword: "srcpass",
      outputFile: out,
      outputPassword: "destpass"
    });
    expect(r.success).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.warnings?.[0].code).toBe("JKS_MULTIPLE_ALIASES");
    expect((r.warnings?.[0].details as { aliases: string[] }).aliases.map((a) => a.toLowerCase()).sort()).toEqual(["alpha", "beta"]);
    expect(existsSync(out)).toBe(false);
  });

  it("JKS→P12 with aliasFilter honors the selection", async () => {
    const jks = join(root, "multi2.jks");
    const out = join(root, "multi2.p12");
    await genJks(jks, "alpha2", "srcpass");
    const r2 = await runKeytool([
      "-genkeypair", "-alias", "beta2", "-keyalg", "RSA", "-keysize", "2048",
      "-validity", "30", "-dname", "CN=beta2,O=Test,C=TW",
      "-keystore", jks, "-storetype", "JKS",
      "-storepass:env", "STORE_PASSWORD", "-keypass:env", "STORE_PASSWORD"
    ], { env: { STORE_PASSWORD: "srcpass" } });
    expect(r2.exitCode).toBe(0);

    const r = await jksToP12({
      jksFile: jks,
      jksPassword: "srcpass",
      outputFile: out,
      outputPassword: "destpass",
      aliasFilter: "beta2"
    });
    expect(r.success).toBe(true);
    const aliases = await listAliases(out, "destpass", "PKCS12");
    expect(aliases.length).toBe(1);
    expect(aliases[0].toLowerCase()).toBe("beta2");
  });

  it("JKS→P12 rejects unknown aliasFilter", async () => {
    const jks = join(root, "reject.jks");
    const out = join(root, "reject.p12");
    await genJks(jks, "real", "srcpass");

    const r = await jksToP12({
      jksFile: jks,
      jksPassword: "srcpass",
      outputFile: out,
      outputPassword: "destpass",
      aliasFilter: "nope"
    });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.aliasNotFound");
  });

  it("JKS→P12 fails with wrong JKS password", async () => {
    const jks = join(root, "wrongpw.jks");
    const out = join(root, "wrongpw.p12");
    await genJks(jks, "k", "rightpass");

    const r = await jksToP12({
      jksFile: jks,
      jksPassword: "WRONGPASS",
      outputFile: out,
      outputPassword: "destpass"
    });
    expect(r.success).toBe(false);
    // Regression for M3 manual-test #3: listAliases stderr used to be truncated
    // to the last 2 lines, which dropped the "password was incorrect" message
    // on modern keytool (appends a stack trace). The mapper then fell back to
    // error.listAliasesFailed. Full stderr is now preserved end-to-end.
    expect(r.message).toBe("error.passwordIncorrect");
  });

  it("P12→JKS round-trips and fixes dest alias to '1'", async () => {
    const jks = join(root, "source.jks");
    const p12 = join(root, "source.p12");
    const jksBack = join(root, "back.jks");

    await genJks(jks, "srcalias", "srcpass");
    const r1 = await jksToP12({
      jksFile: jks, jksPassword: "srcpass",
      outputFile: p12, outputPassword: "p12pass"
    });
    expect(r1.success).toBe(true);

    const r2 = await p12ToJks({
      pfxFile: p12, pfxPassword: "p12pass",
      outputFile: jksBack, outputPassword: "jkspass"
    });
    expect(r2.success).toBe(true);
    expect(r2.outputFiles).toEqual([jksBack]);
    const aliases = await listAliases(jksBack, "jkspass", "JKS");
    expect(aliases.map((a) => a.toLowerCase())).toContain("1");
  });

  it("P12→JKS with multiple aliases and no aliasFilter surfaces PKCS12_MULTIPLE_ALIASES warning", async () => {
    // Build a multi-alias PFX via JKS→P12 with two source entries.
    const jks = join(root, "multi-src.jks");
    const p12 = join(root, "multi-src.p12");
    const jksOut = join(root, "multi-src-back.jks");
    await genJks(jks, "alpha", "srcpass");
    const add = await runKeytool([
      "-genkeypair", "-alias", "beta", "-keyalg", "RSA", "-keysize", "2048",
      "-validity", "30", "-dname", "CN=beta,O=Test,C=TW",
      "-keystore", jks, "-storetype", "JKS",
      "-storepass:env", "STORE_PASSWORD", "-keypass:env", "STORE_PASSWORD"
    ], { env: { STORE_PASSWORD: "srcpass" } });
    expect(add.exitCode).toBe(0);
    // Convert JKS (multi-alias) → P12 as a full keystore migration (no alias filter,
    // directly via keytool so both aliases land in the P12).
    const mig = await runKeytool([
      "-importkeystore",
      "-srckeystore", jks, "-srcstoretype", "JKS",
      "-destkeystore", p12, "-deststoretype", "PKCS12",
      "-srcstorepass:env", "SP",
      "-deststorepass:env", "DP",
      "-noprompt"
    ], { env: { SP: "srcpass", DP: "p12pass" } });
    expect(mig.exitCode, mig.stderr).toBe(0);

    // Now p12ToJks without aliasFilter should refuse and return the warning.
    const warn = await p12ToJks({
      pfxFile: p12, pfxPassword: "p12pass",
      outputFile: jksOut, outputPassword: "jkspass"
    });
    expect(warn.success).toBe(false);
    expect(warn.requiresConfirmation).toBe(true);
    expect(warn.warnings?.[0].code).toBe("PKCS12_MULTIPLE_ALIASES");
    expect((warn.warnings?.[0].details as { aliases: string[] }).aliases.map((a) => a.toLowerCase()).sort())
      .toEqual(["alpha", "beta"]);
    expect(existsSync(jksOut)).toBe(false);

    // With aliasFilter it should succeed and fix dest alias to "1".
    const ok = await p12ToJks({
      pfxFile: p12, pfxPassword: "p12pass",
      outputFile: jksOut, outputPassword: "jkspass",
      aliasFilter: "beta"
    });
    expect(ok.success).toBe(true);
    const outAliases = await listAliases(jksOut, "jkspass", "JKS");
    expect(outAliases.map((a) => a.toLowerCase())).toEqual(["1"]);
  });

  it("P12→JKS with wrong PFX password returns error.passwordIncorrect (not listAliasesFailed)", async () => {
    // Regression for M3 manual-test #4: P12→JKS with wrong password used to
    // fall through to error.listAliasesFailed because keytool writes its
    // "password was incorrect" sentinel to stdout, not stderr.
    const jks = join(root, "pwsrc.jks");
    const p12 = join(root, "pwsrc.p12");
    const jksOut = join(root, "pwsrc-back.jks");
    await genJks(jks, "onlyone", "srcpass");
    const mig = await jksToP12({
      jksFile: jks, jksPassword: "srcpass",
      outputFile: p12, outputPassword: "realpass"
    });
    expect(mig.success).toBe(true);

    const r = await p12ToJks({
      pfxFile: p12, pfxPassword: "WRONGPASS",
      outputFile: jksOut, outputPassword: "jkspass"
    });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.passwordIncorrect");
  });

  it("listKeystoreAliases on a non-keystore file returns error.formatInvalid", async () => {
    // Regression for M3 manual-test #5: feeding a non-P12 file to the alias
    // picker used to return error.listAliasesFailed. Keytool emits "Invalid
    // keystore format" (or DerInputStream / EOF variants) to stdout; full
    // output is now preserved so error-mapper can classify as format error.
    const garbage = join(root, "garbage.p12");
    writeFileSync(garbage, "this is absolutely not a keystore\n".repeat(10));
    const r = await listKeystoreAliases({
      keystoreFile: garbage, keystorePassword: "anything", storeType: "PKCS12"
    });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.formatInvalid");
  });

  it("listKeystoreAliases returns aliases for a JKS", async () => {
    const jks = join(root, "list.jks");
    await genJks(jks, "listed", "listpass");
    const r = await listKeystoreAliases({
      keystoreFile: jks, keystorePassword: "listpass", storeType: "JKS"
    });
    expect(r.success).toBe(true);
    expect(r.details?.aliases.map((a) => a.alias.toLowerCase())).toEqual(["listed"]);
    expect(r.details?.aliases.map((a) => a.entryType)).toEqual(["PrivateKeyEntry"]);
  });
});
