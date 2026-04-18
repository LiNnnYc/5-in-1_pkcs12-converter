import { describe, it, expect } from "vitest";
import { mapError } from "../error-mapper";

describe("mapError", () => {
  it("maps OpenSSL password errors", () => {
    expect(mapError("Mac verify failure").i18nKey).toBe("error.passwordIncorrect");
    expect(mapError("routines:EVP_DecryptFinal_ex:bad decrypt").i18nKey).toBe("error.passwordIncorrect");
  });
  it("maps legacy PBE errors", () => {
    expect(mapError("digital envelope routines::unsupported").i18nKey).toBe("error.legacyRequired");
    expect(mapError("pkcs12 pbe crypt error").i18nKey).toBe("error.legacyRequired");
  });
  it("maps format errors", () => {
    expect(mapError("unable to load certificate").i18nKey).toBe("error.formatInvalid");
    expect(mapError("asn1 encoding routines: not enough data").i18nKey).toBe("error.formatInvalid");
  });
  it("maps timeout", () => {
    expect(mapError("ETIMEDOUT: openssl timed out").i18nKey).toBe("error.timeout");
  });
  it("maps key mismatch sentinel from merge-service", () => {
    expect(mapError("Private key does not match the server certificate").i18nKey).toBe("error.keyMismatch");
  });
  it("maps stale precheck token", () => {
    expect(mapError("Precheck token is stale; please re-run precheck before merging").i18nKey).toBe("error.staleToken");
  });
  it("maps unconfirmed warnings", () => {
    expect(mapError("Unconfirmed warnings: CHAIN_HAS_ANCHOR").i18nKey).toBe("error.unconfirmedWarnings");
  });
  it("maps file not found", () => {
    expect(mapError("ENOENT: no such file or directory").i18nKey).toBe("error.fileNotFound");
  });
  it("maps output not writable", () => {
    expect(mapError("EACCES: permission denied, open '/ro/out.pfx'").i18nKey).toBe("error.outputNotWritable");
  });
  it("falls back to unknown with exitCode details", () => {
    const m = mapError("strange failure", 7);
    expect(m.i18nKey).toBe("error.unknown");
    expect(m.details).toContain("exit 7");
  });
  it("returns unknown for empty input", () => {
    expect(mapError("").i18nKey).toBe("error.unknown");
  });

  // Keytool-specific (M2)
  it("maps keytool password-incorrect variants", () => {
    expect(mapError("keystore was tampered with, or password was incorrect").i18nKey).toBe("error.passwordIncorrect");
    expect(mapError("Source keystore password was incorrect").i18nKey).toBe("error.passwordIncorrect");
  });
  it("maps keytool alias errors", () => {
    expect(mapError("Alias <foo> does not exist").i18nKey).toBe("error.aliasNotFound");
    expect(mapError("source keystore does not contain alias bar").i18nKey).toBe("error.aliasNotFound");
  });
  it("maps keytool legacy PFX stderr", () => {
    expect(mapError("parseAlgParameters failed: ObjectIdentifier 1.2.840.113549.1.12.1.3 not supported").i18nKey).toBe("error.legacyRequired");
    expect(mapError("java.security.NoSuchAlgorithmException: 1.2.840.113549.1.12.1.3").i18nKey).toBe("error.legacyRequired");
    expect(mapError("Legacy PKCS#12 detected — extract with Legacy mode ON").i18nKey).toBe("error.legacyRequired");
  });
  it("maps keytool short-password error", () => {
    expect(mapError("Key password must be at least 6 characters").i18nKey).toBe("error.passwordTooShort");
  });
  it("maps invalid keystore format", () => {
    expect(mapError("Invalid keystore format").i18nKey).toBe("error.formatInvalid");
  });
});
