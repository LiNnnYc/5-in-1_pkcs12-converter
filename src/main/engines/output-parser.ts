import type { CertificateInfo, PrivateKeyInfo, PrivateKeyAlgorithm } from "../../types";

export type OpenSslErrorKind = "legacy" | "password" | "format" | "timeout" | "unknown";

// === Certificate parser ===

function matchFirst(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? m[1].trim() : undefined;
}

function normalizeHex(hex: string): string {
  return hex.replace(/[\s:]+/g, "").toLowerCase();
}

function formatHexColon(hex: string): string {
  const clean = normalizeHex(hex).toUpperCase();
  return clean.match(/.{1,2}/g)?.join(":") ?? clean;
}

// Extract a block of indented lines following a specific header line.
// e.g. after "X509v3 Subject Alternative Name:" the next indented lines belong to it.
function extractIndentedBlock(text: string, header: RegExp): string | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (header.test(lines[i])) {
      const out: string[] = [];
      const baseIndent = lines[i].match(/^\s*/)?.[0].length ?? 0;
      for (let j = i + 1; j < lines.length; j++) {
        const ind = lines[j].match(/^\s*/)?.[0].length ?? 0;
        if (lines[j].trim() === "") continue;
        if (ind <= baseIndent) break;
        out.push(lines[j].trim());
      }
      return out.join(" ");
    }
  }
  return undefined;
}

export function parseCertInfo(opensslText: string): CertificateInfo {
  const subject = matchFirst(opensslText, /^\s*Subject:\s*(.+)$/m) ?? "";
  const issuer = matchFirst(opensslText, /^\s*Issuer:\s*(.+)$/m) ?? "";
  const serialLine = matchFirst(opensslText, /Serial Number:\s*(?:\n\s*)?([0-9a-fA-F:\s]+)(?:\s*\(.+\))?$/m);
  const serialNumber = serialLine ? formatHexColon(serialLine) : "";

  const notBefore = matchFirst(opensslText, /Not Before\s*:\s*(.+)$/m) ?? "";
  const notAfter = matchFirst(opensslText, /Not After\s*:\s*(.+)$/m) ?? "";
  const signatureAlgorithm = matchFirst(opensslText, /Signature Algorithm:\s*(.+)$/m) ?? "";

  // SAN: the block after "X509v3 Subject Alternative Name:"
  const sanBlock = extractIndentedBlock(opensslText, /X509v3 Subject Alternative Name:/);
  const subjectAltNames = sanBlock
    ? sanBlock
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  // SKI: hex after "X509v3 Subject Key Identifier:"
  const skiBlock = extractIndentedBlock(opensslText, /X509v3 Subject Key Identifier:/);
  const subjectKeyIdentifier = skiBlock ? formatHexColon(skiBlock) : undefined;

  // AKI: may contain "keyid:XX:XX..." plus other fields. Extract keyid part.
  const akiBlock = extractIndentedBlock(opensslText, /X509v3 Authority Key Identifier:/);
  let authorityKeyIdentifier: string | undefined;
  if (akiBlock) {
    const keyidMatch = akiBlock.match(/(?:keyid:)?([0-9a-fA-F][0-9a-fA-F:\s]+)/);
    if (keyidMatch) authorityKeyIdentifier = formatHexColon(keyidMatch[1]);
  }

  // Fingerprints: OpenSSL prints these only with -fingerprint flag; parser accepts either form.
  const sha1 = matchFirst(opensslText, /sha1 Fingerprint\s*=\s*([0-9A-Fa-f:]+)/i);
  const sha256 = matchFirst(opensslText, /sha256 Fingerprint\s*=\s*([0-9A-Fa-f:]+)/i);

  return {
    subject,
    issuer,
    serialNumber,
    notBefore,
    notAfter,
    signatureAlgorithm,
    subjectAltNames,
    subjectKeyIdentifier,
    authorityKeyIdentifier,
    fingerprint: {
      sha1: sha1 ? formatHexColon(sha1) : "",
      sha256: sha256 ? formatHexColon(sha256) : ""
    }
  };
}

// === Private key parser ===

export function parsePrivateKeyInfo(opensslText: string): PrivateKeyInfo {
  let algorithm: PrivateKeyAlgorithm = "UNKNOWN";
  let keySize = 0;

  // RSA: "Private-Key: (2048 bit, 2 primes)" or "RSA Private-Key: (2048 bit, 2 primes)"
  const rsa = opensslText.match(/(?:RSA\s+)?Private-Key:\s*\((\d+)\s*bit/);
  if (rsa) {
    algorithm = "RSA";
    keySize = parseInt(rsa[1], 10);
  }

  // EC: "Private-Key: (256 bit)" with "ASN1 OID: prime256v1" below; or EC Private-Key label
  if (/ASN1 OID:|NIST CURVE:|EC Private-Key/.test(opensslText)) {
    algorithm = "EC";
    const ec = opensslText.match(/Private-Key:\s*\((\d+)\s*bit/);
    if (ec) keySize = parseInt(ec[1], 10);
  }

  // DSA
  if (/DSA Private-Key/.test(opensslText)) {
    algorithm = "DSA";
    const dsa = opensslText.match(/Private-Key:\s*\((\d+)\s*bit/);
    if (dsa) keySize = parseInt(dsa[1], 10);
  }

  // Ed25519
  if (/ED25519 Private-Key|Ed25519/.test(opensslText)) {
    algorithm = "ED25519";
    if (keySize === 0) keySize = 256;
  }

  const encrypted = /ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/.test(opensslText);

  return { algorithm, keySize, encrypted };
}

// === Error classifier ===

const LEGACY_PATTERNS = [
  /unsupported algorithm/i,
  /pkcs12 pbe crypt error/i,
  /PKCS12 routines/i,
  /EVP_PBE_alg_add_type/i,
  /digital envelope routines::unsupported/i,
  /error:0308010C/i
];

const PASSWORD_PATTERNS = [
  /mac verify failure/i,
  /bad decrypt/i,
  /invalid password/i,
  /wrong password/i
];

const FORMAT_PATTERNS = [
  /unable to load/i,
  /no certificate matches/i,
  /no certificate found/i,
  /expecting:\s+[A-Z]/i,
  /not enough data/i,
  /asn1 encoding routines/i
];

const TIMEOUT_PATTERNS = [
  /E?TIMEDOUT/i,
  /operation was aborted.*timeout/i
];

export function classifyError(stderr: string): OpenSslErrorKind {
  if (!stderr) return "unknown";
  if (TIMEOUT_PATTERNS.some((re) => re.test(stderr))) return "timeout";
  if (PASSWORD_PATTERNS.some((re) => re.test(stderr))) return "password";
  if (LEGACY_PATTERNS.some((re) => re.test(stderr))) return "legacy";
  if (FORMAT_PATTERNS.some((re) => re.test(stderr))) return "format";
  return "unknown";
}

// Split a multi-cert PEM blob into individual PEM strings.
export function splitPemCerts(pem: string): string[] {
  const re = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  return pem.match(re) ?? [];
}
