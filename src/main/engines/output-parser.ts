import type {
  CertificateInfo,
  PrivateKeyInfo,
  PrivateKeyAlgorithm,
  Pkcs12BagInfo,
  Pkcs12BagKind,
  Pkcs12EncryptionInfo,
  Pkcs12Generation,
  Pkcs12StructureInfo
} from "../../types";

export type OpenSslErrorKind = "legacy" | "password" | "format" | "timeout" | "unknown";

// === Certificate parser ===

function matchFirst(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? m[1].trim() : undefined;
}

function normalizeHex(hex: string): string {
  return hex.replace(/[\s:]+/g, "").toLowerCase();
}

export function formatHexColon(hex: string): string {
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
  // OpenSSL 3.x emits "mac and pad verify failure"; 1.x emits "mac verify failure".
  /mac\b.*verify failure/i,
  /bad decrypt/i,
  /invalid password/i,
  /wrong password/i,
  // "Mac verify error: invalid password?" — top-of-stderr line in OpenSSL 3.
  /mac verify error/i,
  // keytool wrong-password variants (also handled in error-mapper, but keep
  // classify consistent so services sharing classifyError agree).
  /keystore was tampered with.*password was incorrect/i,
  /keystore password was incorrect/i
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

// === PKCS#12 structure parser (from `openssl pkcs12 -info -noout -nokeys -nocerts`) ===

function parseEncryptionLine(remainder: string): Pkcs12EncryptionInfo {
  const parts = remainder.split(",").map((s) => s.trim()).filter(Boolean);
  const info: Pkcs12EncryptionInfo = { scheme: parts[0] ?? "" };
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const iter = p.match(/^Iteration\s+(\d+)$/i);
    if (iter) { info.iterationCount = parseInt(iter[1], 10); continue; }
    const prf = p.match(/^PRF\s+(.+)$/i);
    if (prf) { info.prf = prf[1]; continue; }
    if (/^PBKDF2$/i.test(p)) { info.kdf = "PBKDF2"; continue; }
    // Treat anything that looks like a cipher (AES-*, 3DES, DES-EDE*, CAMELLIA-*) as cipher.
    if (/^(AES|DES|3DES|CAMELLIA|ARIA|SEED|CHACHA)/i.test(p)) { info.cipher = p; continue; }
  }
  // Infer cipher from legacy single-token schemes (no commas, e.g. "pbeWithSHA1And3-KeyTripleDES-CBC").
  if (!info.cipher) {
    const s = info.scheme;
    if (/3-KeyTripleDES/i.test(s)) info.cipher = "3DES (CBC)";
    else if (/40BitRC2/i.test(s)) info.cipher = "RC2-40 (CBC)";
    else if (/128BitRC4/i.test(s)) info.cipher = "RC4-128";
  }
  return info;
}

function deriveGeneration(mac?: string, key?: Pkcs12EncryptionInfo, cert?: Pkcs12EncryptionInfo): Pkcs12Generation {
  if (!mac && !key && !cert) return "unknown";
  const isModern = (e?: Pkcs12EncryptionInfo) =>
    !!e && /^PBES2$/i.test(e.scheme) && /^AES/i.test(e.cipher ?? "");
  const isLegacy = (e?: Pkcs12EncryptionInfo) =>
    !!e && /pbeWithSHA1/i.test(e.scheme);
  const macModern = !!mac && /sha(256|384|512)/i.test(mac);
  const macLegacy = !!mac && /^sha1$/i.test(mac);

  if ((isModern(key) || !key) && (isModern(cert) || !cert) && macModern) return "modern";
  if ((isLegacy(key) || !key) && (isLegacy(cert) || !cert) && macLegacy) return "legacy";
  return "mixed";
}

export function parsePkcs12Structure(text: string): Pkcs12StructureInfo {
  const lines = text.split(/\r?\n/);

  let macAlgorithm: string | undefined;
  let macIterationCount: number | undefined;
  let keyEncryption: Pkcs12EncryptionInfo | undefined;
  let certEncryption: Pkcs12EncryptionInfo | undefined;
  const bags: Pkcs12BagInfo[] = [];

  let current: Pkcs12BagInfo | null = null;
  const pushCurrent = () => {
    if (current) bags.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    const mac = line.match(/^MAC:\s*(\S+)\s*,\s*Iteration\s+(\d+)/i);
    if (mac) { macAlgorithm = mac[1]; macIterationCount = parseInt(mac[2], 10); continue; }

    const pkcs7Enc = line.match(/^PKCS7 Encrypted data:\s*(.+)$/i);
    if (pkcs7Enc) { certEncryption = parseEncryptionLine(pkcs7Enc[1]); continue; }

    const shrouded = line.match(/^(?:PKCS7\s+)?Shrouded Keybag:\s*(.+)$/i);
    if (shrouded) {
      keyEncryption = parseEncryptionLine(shrouded[1]);
      pushCurrent();
      current = { kind: "key" };
      continue;
    }

    if (/^Certificate bag\b/i.test(line)) {
      pushCurrent();
      current = { kind: "cert" };
      continue;
    }

    if (current) {
      const fn = line.match(/^\s+friendlyName:\s*(.+)$/);
      if (fn) { current.friendlyName = fn[1].trim(); continue; }
      const lk = line.match(/^\s+localKeyID:\s*([0-9A-Fa-f\s]+)$/);
      if (lk) {
        current.localKeyId = lk[1].trim().replace(/\s+/g, ":").toUpperCase();
        continue;
      }
    }
  }
  pushCurrent();

  // If Shrouded Keybag appeared but no Certificate bag (or vice versa), still
  // report what we saw. Unknown bags (Bag Attributes without header) fall to "other".
  const normalizedBags: Pkcs12BagInfo[] = bags.map((b) => ({
    ...b,
    kind: (["key", "cert"] as Pkcs12BagKind[]).includes(b.kind) ? b.kind : "other"
  }));

  return {
    macAlgorithm,
    macIterationCount,
    keyEncryption,
    certEncryption,
    bags: normalizedBags,
    generation: deriveGeneration(macAlgorithm, keyEncryption, certEncryption)
  };
}
