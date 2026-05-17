import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import { viewKey } from "../view-key-service";
import { runOpenssl } from "../../engines/openssl-runner";
import { parseCertInfo } from "../../engines/output-parser";
import { resolveOpensslPath } from "../../utils/path-resolver";

const MATERIALS = resolve(process.cwd(), "..", "轉檔程式_測試範本");
const RSA_KEY = join(MATERIALS, "argus2025.key");
const PFX = join(MATERIALS, "argus114.pfx");

const HAS_OPENSSL = existsSync(resolveOpensslPath());
const HAS_RSA_KEY = existsSync(RSA_KEY);
const HAS_PFX = existsSync(PFX);

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "view-key-"));
});

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("view-key-service: validation paths (no openssl required)", () => {
  it("nonexistent file returns fileNotFound", async () => {
    const r = await viewKey({ keyFile: join(tmpRoot, "nope.key") });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.fileNotFound");
  });

  it("relative path returns invalidInput (sanitizer)", async () => {
    const r = await viewKey({ keyFile: "relative/path.key" });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.invalidInput");
  });

  it("random binary file returns unsupportedFileType", async () => {
    const p = join(tmpRoot, "junk.bin");
    writeFileSync(p, Buffer.from([0xff, 0x00, 0x42, 0x77]));
    const r = await viewKey({ keyFile: p });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.unsupportedFileType");
  });

  it("encrypted PEM (header-detectable) returns encryptedKeyNotSupported", async () => {
    const p = join(tmpRoot, "enc.pem");
    writeFileSync(
      p,
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----\n"
    );
    const r = await viewKey({ keyFile: p });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.encryptedKeyNotSupported");
  });
});

const d = HAS_OPENSSL && HAS_RSA_KEY ? describe : describe.skip;

d("view-key-service: real RSA materials (requires openssl + materials)", () => {
  it("parses real argus2025.key (RSA) with non-zero SKI", async () => {
    const r = await viewKey({ keyFile: RSA_KEY });
    expect(r.success, r.message).toBe(true);
    expect(r.details).toBeTruthy();
    const pk = r.details!.privateKey;
    expect(pk.algorithm).toBe("RSA");
    expect(pk.keySize).toBeGreaterThanOrEqual(2048);
    expect(pk.encrypted).toBe(false);
    expect(pk.subjectKeyIdentifier).toBeTruthy();
    // Colon-separated uppercase hex, 20 bytes => 59 chars (20*2 + 19 colons).
    expect(pk.subjectKeyIdentifier!).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){19}$/);
  }, 30_000);

  it("key-side SKI matches cert-side X.509 SKI for the same keypair", async () => {
    const keyR = await viewKey({ keyFile: RSA_KEY });
    expect(keyR.success, keyR.message).toBe(true);
    const keySki = keyR.details!.privateKey.subjectKeyIdentifier;

    // Self-sign a throwaway cert from the same key with `subjectKeyIdentifier=hash`
    // so OpenSSL computes the SKI extension using its own RFC 5280 §4.2.1.2
    // Method 1 implementation. Comparing our key-side SHA-1 against OpenSSL's
    // cert-side SKI proves the two implementations agree — the property the
    // user relies on when eyeballing this value against Windows certificate
    // viewer. (The bundled cert CertB64.cer is not paired with argus2025.key,
    // so we generate a paired cert here instead of trusting materials shape.)
    const selfSigned = join(tmpRoot, "self-signed.pem");
    const sign = await runOpenssl(
      [
        "req", "-x509", "-key", RSA_KEY,
        "-days", "1", "-subj", "/CN=ski-consistency-test",
        "-addext", "subjectKeyIdentifier=hash",
        "-out", selfSigned
      ],
      { timeoutMs: 15_000 }
    );
    expect(sign.exitCode, sign.stderr).toBe(0);

    const r = await runOpenssl(
      ["x509", "-text", "-noout", "-in", selfSigned],
      { timeoutMs: 10_000 }
    );
    expect(r.exitCode).toBe(0);
    const cert = parseCertInfo(r.stdout);
    expect(cert.subjectKeyIdentifier, "cert must carry SKI extension").toBeTruthy();
    expect(keySki).toBe(cert.subjectKeyIdentifier);
  }, 30_000);
});

const pfxD = HAS_OPENSSL && HAS_PFX ? describe : describe.skip;

pfxD("view-key-service: rejects PFX input", () => {
  it("real argus114.pfx returns useViewPkcs12Instead", async () => {
    const r = await viewKey({ keyFile: PFX });
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.useViewPkcs12Instead");
  });
});
