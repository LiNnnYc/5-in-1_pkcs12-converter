import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "" }
}));

import {
  ParsedCert,
  deduplicateCerts,
  buildChain,
  generateChainWarnings,
  writeChainPem,
  parseCertificateFiles
} from "../chain-builder";
import type { CertificateInfo } from "../../../types";
import { runOpenssl } from "../../engines/openssl-runner";
import { resolveOpensslPath } from "../../utils/path-resolver";

// === Helpers for pure logic tests ===

let counter = 0;
function mkInfo(partial: Partial<CertificateInfo>): CertificateInfo {
  counter++;
  return {
    subject: partial.subject ?? `CN=node-${counter}`,
    issuer: partial.issuer ?? `CN=node-${counter}`,
    serialNumber: partial.serialNumber ?? `${counter}`,
    notBefore: "Jan 1 00:00:00 2025 GMT",
    notAfter: "Jan 1 00:00:00 2030 GMT",
    signatureAlgorithm: "sha256WithRSAEncryption",
    subjectAltNames: partial.subjectAltNames ?? [],
    subjectKeyIdentifier: partial.subjectKeyIdentifier,
    authorityKeyIdentifier: partial.authorityKeyIdentifier,
    fingerprint: {
      sha1: partial.fingerprint?.sha1 ?? `sha1-${counter}`,
      sha256: partial.fingerprint?.sha256 ?? `sha256-${counter}`
    }
  };
}

function mkCert(info: Partial<CertificateInfo>, source = "fake.pem"): ParsedCert {
  const full = mkInfo(info);
  return {
    info: full,
    rawPem: `-----BEGIN CERTIFICATE-----\n${full.fingerprint.sha256}\n-----END CERTIFICATE-----\n`,
    sourceFile: source
  };
}

// === Pure logic tests ===

describe("deduplicateCerts", () => {
  it("removes duplicates keyed by sha256", () => {
    const a = mkCert({ fingerprint: { sha1: "s1", sha256: "same" } });
    const b = mkCert({ fingerprint: { sha1: "s2", sha256: "same" } });
    const c = mkCert({ fingerprint: { sha1: "s3", sha256: "other" } });
    const { unique, duplicates } = deduplicateCerts([a, b, c]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toBe(b);
  });
});

describe("buildChain (pure logic)", () => {
  it("builds 3-tier chain via AKI↔SKI", () => {
    const root = mkCert({
      subject: "CN=Root", issuer: "CN=Root",
      subjectKeyIdentifier: "AA:AA", fingerprint: { sha1: "x", sha256: "root" }
    });
    const int = mkCert({
      subject: "CN=Int", issuer: "CN=Root",
      subjectKeyIdentifier: "BB:BB", authorityKeyIdentifier: "AA:AA",
      fingerprint: { sha1: "y", sha256: "int" }
    });
    const srv = mkCert({
      subject: "CN=Srv", issuer: "CN=Int",
      subjectKeyIdentifier: "CC:CC", authorityKeyIdentifier: "BB:BB",
      fingerprint: { sha1: "z", sha256: "srv" }
    });
    const res = buildChain(srv, [srv, int, root]);
    expect(res.chain.map((c) => c.info.subject)).toEqual(["CN=Srv", "CN=Int", "CN=Root"]);
    expect(res.anchor?.info.subject).toBe("CN=Root");
    expect(res.linked).toBe(true);
    expect(res.unrelated).toHaveLength(0);
  });

  it("falls back to subject/issuer DN when SKI/AKI are missing", () => {
    const root = mkCert({ subject: "CN=Root", issuer: "CN=Root", fingerprint: { sha1: "x", sha256: "root" } });
    const int = mkCert({ subject: "CN=Int", issuer: "CN=Root", fingerprint: { sha1: "y", sha256: "int" } });
    const srv = mkCert({ subject: "CN=Srv", issuer: "CN=Int", fingerprint: { sha1: "z", sha256: "srv" } });
    const res = buildChain(srv, [srv, int, root]);
    expect(res.chain.map((c) => c.info.subject)).toEqual(["CN=Srv", "CN=Int", "CN=Root"]);
    expect(res.linked).toBe(true);
  });

  it("filters unrelated certs", () => {
    const root = mkCert({ subject: "CN=Root", issuer: "CN=Root", fingerprint: { sha1: "x", sha256: "root" } });
    const srv = mkCert({ subject: "CN=Srv", issuer: "CN=Root", fingerprint: { sha1: "z", sha256: "srv" } });
    const unrelated = mkCert({ subject: "CN=Noise", issuer: "CN=OtherCA", fingerprint: { sha1: "q", sha256: "noise" } });
    const res = buildChain(srv, [srv, root, unrelated]);
    expect(res.chain).toHaveLength(2);
    expect(res.unrelated).toEqual([unrelated]);
    expect(res.linked).toBe(true);
  });

  it("marks not-linked when supplied chain pool exists but doesn't attach to server", () => {
    const srv = mkCert({
      subject: "CN=Srv", issuer: "CN=Int",
      authorityKeyIdentifier: "BB:BB",
      fingerprint: { sha1: "z", sha256: "srv" }
    });
    const stranger = mkCert({
      subject: "CN=Stranger", issuer: "CN=OtherRoot",
      subjectKeyIdentifier: "ZZ:ZZ",
      fingerprint: { sha1: "u", sha256: "stranger" }
    });
    const res = buildChain(srv, [srv, stranger]);
    expect(res.chain).toHaveLength(1);
    expect(res.linked).toBe(false);
    expect(res.anchor).toBeUndefined();
  });

  it("marks linked when no chain certs supplied at all", () => {
    const srv = mkCert({
      subject: "CN=Srv", issuer: "CN=Int",
      authorityKeyIdentifier: "BB:BB",
      fingerprint: { sha1: "z2", sha256: "srv-alone" }
    });
    const res = buildChain(srv, [srv]);
    expect(res.chain).toHaveLength(1);
    expect(res.linked).toBe(true);
  });

  it("guards against infinite loops on cyclic issuer graph", () => {
    // a.issuer=b, b.issuer=a — pathological but must not hang
    const a = mkCert({ subject: "CN=A", issuer: "CN=B", fingerprint: { sha1: "1", sha256: "a" } });
    const b = mkCert({ subject: "CN=B", issuer: "CN=A", fingerprint: { sha1: "2", sha256: "b" } });
    const res = buildChain(a, [a, b]);
    expect(res.chain.length).toBeLessThanOrEqual(3);
  });
});

describe("generateChainWarnings", () => {
  const root = mkCert({ subject: "CN=Root", issuer: "CN=Root", fingerprint: { sha1: "r1", sha256: "root-w" } });
  const int = mkCert({ subject: "CN=Int", issuer: "CN=Root", fingerprint: { sha1: "i1", sha256: "int-w" } });
  const srv = mkCert({ subject: "CN=Srv", issuer: "CN=Int", fingerprint: { sha1: "s1", sha256: "srv-w" } });
  const dup = mkCert({ subject: "CN=Int", issuer: "CN=Root", fingerprint: { sha1: "i2", sha256: "int-w" } });
  const noise = mkCert({ subject: "CN=X", issuer: "CN=Y", fingerprint: { sha1: "n1", sha256: "noise-w" } });

  it("emits ANCHOR + EXTRA + DUPLICATE + REORDERED for mixed scenario", () => {
    // User supplied in reversed order: [root, int, noise], then server is its own input.
    // After dedup: [root, int, noise]. Build yields [srv, int, root]. noise is unrelated.
    const result = buildChain(srv, [srv, root, int, noise]);
    const warnings = generateChainWarnings(result, [root, int, noise], [dup]);
    const codes = warnings.map((w) => w.code).sort();
    expect(codes).toContain("CHAIN_HAS_DUPLICATE_CERTS");
    expect(codes).toContain("CHAIN_HAS_EXTRA_CERTS");
    expect(codes).toContain("CHAIN_HAS_ANCHOR");
    expect(codes).toContain("CHAIN_REORDERED");
  });

  it("emits no warnings for clean input already in correct order", () => {
    // Deliberately choose a chain without a self-signed anchor, so CHAIN_HAS_ANCHOR
    // does not fire; intermediate has AKI to make `linked` true via the
    // "top has no AKI" fallback — instead we omit the intermediate's AKI so top
    // has no AKI and counts as linked.
    const i2 = mkCert({ subject: "CN=Int2", issuer: "CN=ExternalRoot",
      fingerprint: { sha1: "i3", sha256: "int2" } });
    const s2 = mkCert({ subject: "CN=Srv2", issuer: "CN=Int2",
      fingerprint: { sha1: "s2", sha256: "srv2" } });
    const result = buildChain(s2, [s2, i2]);
    const warnings = generateChainWarnings(result, [i2], []);
    expect(warnings).toHaveLength(0);
  });

  it("detects CHAIN_NOT_LINKED when supplied chain certs don't link to server", () => {
    const s3 = mkCert({
      subject: "CN=Srv3", issuer: "CN=GhostCA",
      authorityKeyIdentifier: "FF:FF",
      fingerprint: { sha1: "s3", sha256: "srv3" }
    });
    const unrelated = mkCert({
      subject: "CN=Other", issuer: "CN=OtherRoot",
      subjectKeyIdentifier: "ZZ:ZZ",
      fingerprint: { sha1: "u1", sha256: "unrel" }
    });
    const result = buildChain(s3, [s3, unrelated]);
    const warnings = generateChainWarnings(result, [unrelated], []);
    expect(warnings.some((w) => w.code === "CHAIN_NOT_LINKED")).toBe(true);
  });

  it("does not warn CHAIN_NOT_LINKED when no chain certs supplied", () => {
    const s4 = mkCert({
      subject: "CN=Srv4", issuer: "CN=GhostCA",
      authorityKeyIdentifier: "FF:FF",
      fingerprint: { sha1: "s4", sha256: "srv4" }
    });
    const result = buildChain(s4, [s4]);
    const warnings = generateChainWarnings(result, [], []);
    expect(warnings.some((w) => w.code === "CHAIN_NOT_LINKED")).toBe(false);
  });

  it("does not warn CHAIN_NOT_LINKED when chain reaches an intermediate but not a root", () => {
    const int = mkCert({
      subject: "CN=Int", issuer: "CN=ExternalRoot",
      subjectKeyIdentifier: "BB:BB", authorityKeyIdentifier: "AA:AA",
      fingerprint: { sha1: "y", sha256: "int-only" }
    });
    const srv = mkCert({
      subject: "CN=Srv", issuer: "CN=Int",
      subjectKeyIdentifier: "CC:CC", authorityKeyIdentifier: "BB:BB",
      fingerprint: { sha1: "z", sha256: "srv-only" }
    });
    const result = buildChain(srv, [srv, int]);
    const warnings = generateChainWarnings(result, [int], []);
    expect(warnings.some((w) => w.code === "CHAIN_NOT_LINKED")).toBe(false);
  });
});

describe("writeChainPem", () => {
  it("concatenates rawPem of each chain cert into the output file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "pkcs12-chain-"));
    try {
      const a = mkCert({ subject: "CN=A" });
      const b = mkCert({ subject: "CN=B" });
      a.rawPem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
      b.rawPem = "-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----\n";
      const out = join(tmp, "chain.pem");
      await writeChainPem([a, b], out);
      const body = readFileSync(out, "utf8");
      expect(body).toBe(a.rawPem + b.rawPem);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// === Integration tests (real openssl producing a 3-tier chain) ===

const HAS_OPENSSL = existsSync(resolveOpensslPath());
const d = HAS_OPENSSL ? describe : describe.skip;

d("chain-builder integration (real openssl)", () => {
  let workDir: string;
  let rootPem: string, intPem: string, srvPem: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "pkcs12-chain-int-"));

    const rootKey = join(workDir, "root.key");
    const intKey = join(workDir, "int.key");
    const srvKey = join(workDir, "srv.key");
    rootPem = join(workDir, "root.pem");
    intPem = join(workDir, "int.pem");
    srvPem = join(workDir, "srv.pem");
    const intCsr = join(workDir, "int.csr");
    const srvCsr = join(workDir, "srv.csr");
    const intExt = join(workDir, "int.cnf");
    const srvExt = join(workDir, "srv.cnf");

    writeFileSync(intExt,
      "basicConstraints=critical,CA:TRUE,pathlen:0\n" +
      "keyUsage=critical,keyCertSign,cRLSign\n" +
      "subjectKeyIdentifier=hash\n" +
      "authorityKeyIdentifier=keyid:always\n"
    );
    writeFileSync(srvExt,
      "basicConstraints=critical,CA:FALSE\n" +
      "keyUsage=critical,digitalSignature,keyEncipherment\n" +
      "subjectKeyIdentifier=hash\n" +
      "authorityKeyIdentifier=keyid,issuer\n"
    );

    const run = async (args: string[]) => {
      const r = await runOpenssl(args);
      if (r.exitCode !== 0) throw new Error(`openssl failed: ${args.join(" ")}\n${r.stderr}`);
      return r;
    };

    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", rootKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", intKey]);
    await run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", srvKey]);

    await run([
      "req", "-new", "-x509", "-key", rootKey, "-out", rootPem, "-days", "7",
      "-subj", "/CN=TestRoot",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-addext", "subjectKeyIdentifier=hash"
    ]);
    await run(["req", "-new", "-key", intKey, "-subj", "/CN=TestIntermediate", "-out", intCsr]);
    await run([
      "x509", "-req", "-in", intCsr, "-CA", rootPem, "-CAkey", rootKey,
      "-CAcreateserial", "-extfile", intExt, "-out", intPem, "-days", "7"
    ]);
    await run(["req", "-new", "-key", srvKey, "-subj", "/CN=server.test", "-out", srvCsr]);
    await run([
      "x509", "-req", "-in", srvCsr, "-CA", intPem, "-CAkey", intKey,
      "-CAcreateserial", "-extfile", srvExt, "-out", srvPem, "-days", "7"
    ]);
  }, 120_000);

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("parses 3 files into 3 ParsedCert with SKI/AKI populated", async () => {
    const certs = await parseCertificateFiles([rootPem, intPem, srvPem], workDir);
    expect(certs).toHaveLength(3);
    const subjects = certs.map((c) => c.info.subject).join("\n");
    expect(subjects).toContain("TestRoot");
    expect(subjects).toContain("TestIntermediate");
    expect(subjects).toContain("server.test");
    const leaf = certs.find((c) => c.info.subject.includes("server.test"))!;
    expect(leaf.info.authorityKeyIdentifier).toBeTruthy();
  });

  it("buildChain finds full chain and marks it linked+anchored for real certs", async () => {
    const [root, int, srv] = await parseCertificateFiles([rootPem, intPem, srvPem], workDir);
    const res = buildChain(srv, [srv, int, root]);
    expect(res.chain).toHaveLength(3);
    expect(res.chain[0].info.subject).toContain("server.test");
    expect(res.chain[2].info.subject).toContain("TestRoot");
    expect(res.linked).toBe(true);
    expect(res.anchor?.info.subject).toContain("TestRoot");
  });

  it("chain stays correct when user supplies files in reverse order", async () => {
    const [root, int, srv] = await parseCertificateFiles([rootPem, intPem, srvPem], workDir);
    const res = buildChain(srv, [srv, root, int]);
    expect(res.chain.map((c) => c.info.subject).join("|")).toMatch(/server\.test.*TestIntermediate.*TestRoot/);
  });
});
