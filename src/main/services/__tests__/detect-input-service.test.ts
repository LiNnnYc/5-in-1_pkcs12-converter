import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import { detectInputType } from "../detect-input-service";
import { runOpenssl } from "../../engines/openssl-runner";
import { resolveOpensslPath } from "../../utils/path-resolver";

const MATERIALS = resolve(process.cwd(), "..", "轉檔程式_測試範本");
const REAL_PKCS8_KEY = join(MATERIALS, "argus2025.key");
const REAL_PFX = join(MATERIALS, "argus114.pfx");

const HAS_OPENSSL = existsSync(resolveOpensslPath());
const HAS_PKCS8_KEY = existsSync(REAL_PKCS8_KEY);
const HAS_PFX = existsSync(REAL_PFX);

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "detect-input-"));
});

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

function writeFixture(name: string, content: string | Buffer): string {
  const p = join(tmpRoot, name);
  writeFileSync(p, content);
  return p;
}

// 5s probe + a little headroom for filesystem / process spawn jitter.
// `detectInputType` itself promises ≤ 3 sequential probes × 5s = 15s worst case,
// but in practice each test should be well under 5s.
const CASE_BUDGET_MS = 6_000;

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

describe("detect-input-service: header-only detection (no openssl required)", () => {
  it("PEM ENCRYPTED PRIVATE KEY → keyEncrypted", async () => {
    const p = writeFixture(
      "enc-pkcs8.pem",
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----\n"
    );
    const { result, ms } = await timed(() => detectInputType(p));
    expect(result.kind).toBe("keyEncrypted");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("Traditional PEM RSA with Proc-Type: 4,ENCRYPTED → keyEncrypted", async () => {
    const p = writeFixture(
      "trad-enc.pem",
      "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,XXXX\n\nAAAA\n-----END RSA PRIVATE KEY-----\n"
    );
    const { result, ms } = await timed(() => detectInputType(p));
    expect(result.kind).toBe("keyEncrypted");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("Traditional PEM RSA without Proc-Type → keyUnencrypted", async () => {
    const p = writeFixture(
      "trad-plain.pem",
      "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----\n"
    );
    const { result, ms } = await timed(() => detectInputType(p));
    expect(result.kind).toBe("keyUnencrypted");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("Traditional PEM EC without Proc-Type → keyUnencrypted", async () => {
    const p = writeFixture(
      "ec-plain.pem",
      "-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----\n"
    );
    const { result, ms } = await timed(() => detectInputType(p));
    expect(result.kind).toBe("keyUnencrypted");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("empty file → unknown", async () => {
    const p = writeFixture("empty.bin", Buffer.alloc(0));
    const { result, ms } = await timed(() => detectInputType(p));
    expect(result.kind).toBe("unknown");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("random binary (non-0x30 first byte) → unknown", async () => {
    const p = writeFixture("random.bin", Buffer.from([0xff, 0x00, 0x42, 0x77, 0x88]));
    const { result, ms } = await timed(() => detectInputType(p));
    expect(result.kind).toBe("unknown");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("nonexistent path → unknown with reason", async () => {
    const { result, ms } = await timed(() =>
      detectInputType(join(tmpRoot, "does-not-exist.bin"))
    );
    expect(result.kind).toBe("unknown");
    expect(result.reason).toBeTruthy();
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });
});

const d = HAS_OPENSSL && HAS_PKCS8_KEY && HAS_PFX ? describe : describe.skip;

d("detect-input-service: probe-based detection (requires openssl + materials)", () => {
  let pkcs8Encrypted: string;
  let derKey: string;
  let derPfx: string;

  beforeAll(async () => {
    // Generate PKCS#8 encrypted from the real unencrypted PKCS#8 key.
    pkcs8Encrypted = join(tmpRoot, "enc-real.pem");
    const encResult = await runOpenssl(
      ["pkcs8", "-topk8", "-in", REAL_PKCS8_KEY, "-out", pkcs8Encrypted,
       "-passout", "env:OUT_PW", "-v2", "aes-256-cbc"],
      { env: { OUT_PW: "probepw" }, timeoutMs: 10_000 }
    );
    if (encResult.exitCode !== 0) {
      throw new Error(`Failed to create encrypted PKCS#8 fixture: ${encResult.stderr}`);
    }

    // DER-encoded private key (no encryption).
    derKey = join(tmpRoot, "key.der");
    const derKeyR = await runOpenssl(
      ["pkey", "-in", REAL_PKCS8_KEY, "-outform", "DER", "-out", derKey],
      { timeoutMs: 10_000 }
    );
    if (derKeyR.exitCode !== 0) {
      throw new Error(`Failed to create DER key fixture: ${derKeyR.stderr}`);
    }

    // DER PFX is just the raw .pfx file — copy it under tmpRoot so cleanup is unified.
    derPfx = join(tmpRoot, "real.pfx");
    writeFileSync(derPfx, readFileSync(REAL_PFX));
  });

  it("PEM PKCS#8 unencrypted (real argus2025.key) → keyUnencrypted", async () => {
    const { result, ms } = await timed(() => detectInputType(REAL_PKCS8_KEY));
    expect(result.kind).toBe("keyUnencrypted");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("PEM PKCS#8 encrypted → keyEncrypted", async () => {
    const { result, ms } = await timed(() => detectInputType(pkcs8Encrypted));
    expect(result.kind).toBe("keyEncrypted");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("DER PFX → pfx", async () => {
    const { result, ms } = await timed(() => detectInputType(derPfx));
    expect(result.kind).toBe("pfx");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("DER private key → keyUnencrypted", async () => {
    const { result, ms } = await timed(() => detectInputType(derKey));
    expect(result.kind).toBe("keyUnencrypted");
    expect(ms).toBeLessThan(CASE_BUDGET_MS);
  });

  it("DER-shaped random bytes (0x30 head but invalid ASN.1) → unknown", async () => {
    // Starts with 0x30 to force the DER probe path, but body is junk.
    const p = writeFixture(
      "der-junk.bin",
      Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x23]), Buffer.alloc(32, 0xab)])
    );
    const { result, ms } = await timed(() => detectInputType(p));
    expect(result.kind).toBe("unknown");
    // Two probes worst case for DER junk (PFX then key), so allow a bit more.
    expect(ms).toBeLessThan(CASE_BUDGET_MS * 2);
  });
});
