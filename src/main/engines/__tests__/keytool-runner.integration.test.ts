import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => ""
  }
}));

import { runKeytool, listAliases, parseAliasList } from "../keytool-runner";
import { resolveKeytoolPath } from "../../utils/path-resolver";

const KEYTOOL = resolveKeytoolPath();
const HAS_KEYTOOL = existsSync(KEYTOOL);

const d = HAS_KEYTOOL ? describe : describe.skip;

let workDir: string;

async function genKeystore(path: string, alias: string, password: string, storeType: "JKS" | "PKCS12"): Promise<void> {
  const r = await runKeytool([
    "-genkeypair",
    "-alias", alias,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "30",
    "-dname", `CN=${alias},O=Test,C=TW`,
    "-keystore", path,
    "-storetype", storeType,
    "-storepass:env", "STORE_PASSWORD",
    "-keypass:env", "STORE_PASSWORD"
  ], { env: { STORE_PASSWORD: password } });
  if (r.exitCode !== 0) {
    throw new Error(`genkeypair failed: ${r.stderr}`);
  }
}

d("keytool-runner integration (real keytool.exe)", () => {
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "pkcs12-keytool-"));
  });

  afterAll(() => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it("runKeytool -help shows version banner with exit 0", async () => {
    const r = await runKeytool(["-help"]);
    expect(r.exitCode).toBe(0);
    // Keytool prints its subcommand list to stderr; either stream should mention keytool.
    const combined = r.stdout + r.stderr;
    expect(combined.toLowerCase()).toContain("keytool");
  });

  it("listAliases returns single alias from a fresh JKS", async () => {
    const ks = join(workDir, "single.jks");
    await genKeystore(ks, "mykey", "changeit", "JKS");
    const aliases = await listAliases(ks, "changeit", "JKS");
    expect(aliases.length).toBe(1);
    expect(aliases[0].toLowerCase()).toBe("mykey");
  });

  it("listAliases returns multiple aliases from multi-entry JKS", async () => {
    const ks = join(workDir, "multi.jks");
    await genKeystore(ks, "alpha", "changeit", "JKS");
    // Add second alias by running genkeypair again against same keystore
    const r = await runKeytool([
      "-genkeypair",
      "-alias", "beta",
      "-keyalg", "RSA",
      "-keysize", "2048",
      "-validity", "30",
      "-dname", "CN=beta,O=Test,C=TW",
      "-keystore", ks,
      "-storetype", "JKS",
      "-storepass:env", "STORE_PASSWORD",
      "-keypass:env", "STORE_PASSWORD"
    ], { env: { STORE_PASSWORD: "changeit" } });
    expect(r.exitCode).toBe(0);

    const aliases = await listAliases(ks, "changeit", "JKS");
    expect(aliases.length).toBe(2);
    expect(aliases.map((a) => a.toLowerCase()).sort()).toEqual(["alpha", "beta"]);
  });

  it("listAliases works on PKCS12 keystores", async () => {
    const ks = join(workDir, "p.p12");
    await genKeystore(ks, "p12alias", "changeit", "PKCS12");
    const aliases = await listAliases(ks, "changeit", "PKCS12");
    expect(aliases.length).toBe(1);
  });

  it("listAliases rejects with non-zero exit on wrong password", async () => {
    const ks = join(workDir, "pwfail.jks");
    await genKeystore(ks, "k", "rightpw", "JKS");
    await expect(listAliases(ks, "wrongpw", "JKS")).rejects.toThrow();
  });

  it("runKeytool respects short timeout without hanging", async () => {
    const r = await runKeytool(["-help"], { timeoutMs: 1 });
    // Either timed out (-1) or completed almost instantly (0) — both acceptable.
    expect([-1, 0]).toContain(r.exitCode);
  });
});

describe("parseAliasList (pure)", () => {
  it("extracts alias names from -list -rfc output", () => {
    const stdout = [
      "Keystore type: JKS",
      "Keystore provider: SUN",
      "",
      "Your keystore contains 2 entries",
      "",
      "Alias name: alpha",
      "Creation date: Apr 18, 2026",
      "Entry type: PrivateKeyEntry",
      "",
      "Alias name: beta",
      "Entry type: PrivateKeyEntry",
      ""
    ].join("\n");
    expect(parseAliasList(stdout)).toEqual(["alpha", "beta"]);
  });

  it("returns empty array when no aliases present", () => {
    expect(parseAliasList("Keystore contains 0 entries")).toEqual([]);
  });
});
