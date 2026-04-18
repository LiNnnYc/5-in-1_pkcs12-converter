import { describe, it, expect } from "vitest";
import {
  parseCertInfo,
  parsePrivateKeyInfo,
  classifyError,
  splitPemCerts
} from "../output-parser";

// Fixture: typical `openssl x509 -text -noout -fingerprint -sha256` output.
const RSA_CERT_TEXT = `Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number:
            0a:1b:2c:3d:4e:5f:60:71
        Signature Algorithm: sha256WithRSAEncryption
        Issuer: C=TW, O=Example Root CA, CN=Example Root CA
        Validity
            Not Before: Jan  1 00:00:00 2025 GMT
            Not After : Dec 31 23:59:59 2026 GMT
        Subject: C=TW, O=Example Corp, CN=example.com
        Subject Public Key Info:
            Public Key Algorithm: rsaEncryption
                Public-Key: (2048 bit)
        X509v3 extensions:
            X509v3 Subject Alternative Name:
                DNS:example.com, DNS:www.example.com, IP Address:10.0.0.1
            X509v3 Subject Key Identifier:
                AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD
            X509v3 Authority Key Identifier:
                keyid:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44
    Signature Algorithm: sha256WithRSAEncryption
SHA1 Fingerprint=AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD
SHA256 Fingerprint=11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00
`;

const EC_KEY_TEXT = `Private-Key: (256 bit)
priv:
    aa:bb:cc:dd:ee:ff
pub:
    04:11:22:33
ASN1 OID: prime256v1
NIST CURVE: P-256
`;

const RSA_KEY_TEXT = `Private-Key: (2048 bit, 2 primes)
modulus:
    00:a0:b1:c2
publicExponent: 65537 (0x10001)
`;

const CERT_WITHOUT_EXT = `Certificate:
    Data:
        Version: 1 (0x0)
        Serial Number: 12345 (0x3039)
        Signature Algorithm: sha1WithRSAEncryption
        Issuer: CN=Legacy CA
        Validity
            Not Before: Jan 1 00:00:00 2010 GMT
            Not After : Jan 1 00:00:00 2015 GMT
        Subject: CN=old.example.com
`;

const MULTI_PEM = `-----BEGIN CERTIFICATE-----
AAAA
-----END CERTIFICATE-----
random text between
-----BEGIN CERTIFICATE-----
BBBB
CCCC
-----END CERTIFICATE-----
`;

describe("parseCertInfo", () => {
  it("extracts all fields from a complete RSA cert", () => {
    const info = parseCertInfo(RSA_CERT_TEXT);
    expect(info.subject).toContain("CN=example.com");
    expect(info.issuer).toContain("Example Root CA");
    expect(info.serialNumber).toBe("0A:1B:2C:3D:4E:5F:60:71");
    expect(info.notBefore).toContain("Jan");
    expect(info.notAfter).toContain("Dec 31");
    expect(info.signatureAlgorithm).toBe("sha256WithRSAEncryption");
    expect(info.subjectAltNames).toEqual(["DNS:example.com", "DNS:www.example.com", "IP Address:10.0.0.1"]);
    expect(info.subjectKeyIdentifier).toMatch(/^AA:BB:CC:DD/);
    expect(info.authorityKeyIdentifier).toMatch(/^11:22:33:44/);
    expect(info.fingerprint.sha1).toMatch(/^AA:BB:CC:DD/);
    expect(info.fingerprint.sha256).toMatch(/^11:22:33:44/);
  });

  it("returns empty SAN / SKI / AKI when cert has no extensions", () => {
    const info = parseCertInfo(CERT_WITHOUT_EXT);
    expect(info.subjectAltNames).toEqual([]);
    expect(info.subjectKeyIdentifier).toBeUndefined();
    expect(info.authorityKeyIdentifier).toBeUndefined();
    expect(info.fingerprint.sha1).toBe("");
    expect(info.fingerprint.sha256).toBe("");
    expect(info.subject).toContain("old.example.com");
  });
});

describe("parsePrivateKeyInfo", () => {
  it("recognises RSA 2048", () => {
    const info = parsePrivateKeyInfo(RSA_KEY_TEXT);
    expect(info.algorithm).toBe("RSA");
    expect(info.keySize).toBe(2048);
    expect(info.encrypted).toBe(false);
  });
  it("recognises EC P-256", () => {
    const info = parsePrivateKeyInfo(EC_KEY_TEXT);
    expect(info.algorithm).toBe("EC");
    expect(info.keySize).toBe(256);
  });
  it("recognises encrypted PEM marker", () => {
    const text = "-----BEGIN ENCRYPTED PRIVATE KEY-----\ndata\n-----END ENCRYPTED PRIVATE KEY-----\n";
    const info = parsePrivateKeyInfo(text);
    expect(info.encrypted).toBe(true);
  });
  it("returns UNKNOWN algorithm on empty input", () => {
    const info = parsePrivateKeyInfo("");
    expect(info.algorithm).toBe("UNKNOWN");
    expect(info.keySize).toBe(0);
  });
});

describe("classifyError", () => {
  it("maps legacy PBE errors", () => {
    expect(classifyError("Error: pkcs12 pbe crypt error")).toBe("legacy");
    expect(classifyError("digital envelope routines::unsupported")).toBe("legacy");
    expect(classifyError("40E0000000000000:error:0308010C:something")).toBe("legacy");
  });
  it("maps password errors", () => {
    expect(classifyError("Mac verify failure")).toBe("password");
    expect(classifyError("routines:EVP_DecryptFinal_ex:bad decrypt")).toBe("password");
  });
  it("maps format errors", () => {
    expect(classifyError("unable to load certificate")).toBe("format");
    expect(classifyError("ASN1 encoding routines: not enough data")).toBe("format");
  });
  it("maps timeouts", () => {
    expect(classifyError("ETIMEDOUT: openssl timed out")).toBe("timeout");
  });
  it("maps unknown", () => {
    expect(classifyError("some random gibberish")).toBe("unknown");
    expect(classifyError("")).toBe("unknown");
  });
});

describe("splitPemCerts", () => {
  it("returns each PEM block", () => {
    const blocks = splitPemCerts(MULTI_PEM);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("AAAA");
    expect(blocks[1]).toContain("BBBB");
  });
  it("returns empty array on non-PEM input", () => {
    expect(splitPemCerts("not a pem")).toEqual([]);
  });
});
