import type { KeyViewResult, OperationResult, ViewKeyRequest } from "../../types";
import { validateFilePath, validationErrorKey } from "../utils/sanitizer";
import { parseKeyInfo, subjectKeyIdentifierFromKey } from "../engines/openssl-runner";
import { classifyError, parsePrivateKeyInfo } from "../engines/output-parser";
import { detectInputType } from "./detect-input-service";
import { createLogger } from "../utils/logger";

const log = createLogger("viewKey");

// Standalone .key/.pem private key viewer. Companion to viewPkcs12 — used
// when the user wants to read SKI off a bare private key file and compare
// with the SKI shown by Windows certificate viewer on the matching cert.
//
// v1 explicitly refuses encrypted keys: the merge/extract flows already
// handle passwords, but adding a password UX here just for read-only viewing
// would broaden scope without clear user value (see docs_archive/KEY_VIEW_PLAN.md decision 5).
export async function viewKey(
  params: ViewKeyRequest
): Promise<OperationResult<KeyViewResult>> {
  const v = validateFilePath(params.keyFile);
  if (!v.ok) {
    return { success: false, message: validationErrorKey(v) };
  }

  const detected = await detectInputType(params.keyFile);
  if (detected.kind === "keyEncrypted") {
    return { success: false, message: "error.encryptedKeyNotSupported" };
  }
  if (detected.kind === "pfx") {
    return { success: false, message: "error.useViewPkcs12Instead" };
  }
  if (detected.kind === "unknown") {
    return { success: false, message: "error.unsupportedFileType" };
  }

  // detected.kind === "keyUnencrypted"
  const keyText = await parseKeyInfo(params.keyFile);
  if (keyText.exitCode !== 0) {
    const kind = classifyError(keyText.stderr);
    log.error("viewKey: openssl pkey failed", {
      exitCode: keyText.exitCode,
      classifiedAs: kind,
      stderrHead: keyText.stderr.slice(0, 200)
    });
    if (kind === "password") {
      // Reached only if the detector said "unencrypted" but openssl disagrees —
      // surface as encrypted-key error so the user gets a coherent message.
      return { success: false, message: "error.encryptedKeyNotSupported" };
    }
    return { success: false, message: "error.opensslFailed" };
  }

  const privateKey = parsePrivateKeyInfo(keyText.stdout);
  const ski = await subjectKeyIdentifierFromKey(params.keyFile);
  if (ski) privateKey.subjectKeyIdentifier = ski;

  return {
    success: true,
    message: "ok",
    details: { privateKey }
  };
}
