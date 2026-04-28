import { classifyError } from "../engines/output-parser";

export type MappedError = {
  i18nKey: string;
  details?: string;
};

// Map a raw OpenSSL / Keytool error (stderr + optional message context) to a
// renderer-friendly i18n key. The renderer resolves the key via vue-i18n.
//
// Layered detection: our own domain-specific sentinels first (they carry
// higher confidence), then classifyError for OpenSSL stderr patterns, then a
// last-resort generic unknown.
export function mapError(stderrOrMessage: string, exitCode?: number): MappedError {
  const s = stderrOrMessage ?? "";

  // Domain sentinels raised by services before we even talk to OpenSSL.
  if (/precheck token is stale/i.test(s) || /stale/i.test(s) && /precheck/i.test(s)) {
    return { i18nKey: "error.staleToken" };
  }
  if (/unconfirmed warnings/i.test(s)) {
    return { i18nKey: "error.unconfirmedWarnings", details: s };
  }
  if (/does not match the server certificate/i.test(s) || /key.*mismatch/i.test(s)) {
    return { i18nKey: "error.keyMismatch" };
  }
  if (/file does not exist|no such file|enoent/i.test(s)) {
    return { i18nKey: "error.fileNotFound" };
  }
  if (/not writable|eacces|permission denied/i.test(s)) {
    return { i18nKey: "error.outputNotWritable" };
  }
  if (/password must not be empty|invalid.*password.*empty/i.test(s)) {
    return { i18nKey: "error.passwordEmpty" };
  }

  // Keytool sentinels (M2 JKS path) — keytool writes English messages to stderr.
  if (/keystore was tampered with.*password was incorrect|password was incorrect/i.test(s)) {
    return { i18nKey: "error.passwordIncorrect" };
  }
  if (/alias.*does not exist|alias.*not found|does not contain alias/i.test(s)) {
    return { i18nKey: "error.aliasNotFound" };
  }
  // Legacy PKCS#12 surfaced by our service probe (convert-service rejects
  // before calling keytool, but keytool's own stderr is "parseAlgParameters
  // failed" or NoSuchAlgorithmException when it does reach it).
  if (/legacy pkcs#?12 detected|parsealgparameters failed|nosuchalgorithmexception/i.test(s)) {
    return { i18nKey: "error.legacyRequired" };
  }
  if (/keystore password was incorrect|source keystore password|destination keystore password/i.test(s)) {
    return { i18nKey: "error.passwordIncorrect" };
  }
  // Keytool's minimum password is 6 chars; if our validator didn't catch it
  // (e.g. bypassed via IPC direct), keytool itself complains.
  if (/password must be at least 6 characters|keystore password must be/i.test(s)) {
    return { i18nKey: "error.passwordTooShort" };
  }
  if (
    /input not an x\.509 certificate|keystore load.*invalid|not a valid keystore|invalid keystore format/i.test(s) ||
    // Additional keytool variants seen on JDK 17+ when fed non-keystore content:
    //   - "toDerInputStream rejects tag type N" (ASN.1 header unparseable)
    //   - "java.io.EOFException" (file too small / truncated)
    //   - "not a PKCS#12 file" / "DerInputStream.getLength(): lengthTag=..."
    /toderinputstream rejects tag type|java\.io\.eofexception|not a pkcs#?12 file|derinputstream\.getlength/i.test(s)
  ) {
    return { i18nKey: "error.formatInvalid" };
  }

  // OpenSSL stderr classification
  const kind = classifyError(s);
  if (kind === "password") return { i18nKey: "error.passwordIncorrect" };
  if (kind === "legacy") return { i18nKey: "error.legacyRequired" };
  if (kind === "timeout") return { i18nKey: "error.timeout" };
  if (kind === "format") return { i18nKey: "error.formatInvalid" };

  // Fallback
  return {
    i18nKey: "error.unknown",
    details: exitCode !== undefined ? `${s} (exit ${exitCode})` : s || undefined
  };
}
