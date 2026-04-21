import { readFile, writeFile } from "node:fs/promises";
import type { OperationResult, Pkcs12ViewResult, ViewRequest, CertificateInfo } from "../../types";
import { validateFilePath, validatePassword } from "../utils/sanitizer";
import { TempFileManager } from "../utils/temp-file";
import { resolveWorkDir } from "../utils/path-resolver";
import {
  parseCertificateText,
  parseKeyInfo,
  publicKeyFingerprintFromCert,
  publicKeyFingerprintFromKey,
  runOpenssl
} from "../engines/openssl-runner";
import { classifyError, parseCertInfo, parsePrivateKeyInfo, splitPemCerts } from "../engines/output-parser";
import { createLogger } from "../utils/logger";

const log = createLogger("view");

async function probeAndExtract(
  pfxFile: string,
  pfxPassword: string,
  forceLegacy: boolean | undefined,
  extractArgs: string[],
  outPath: string
): Promise<{ exitCode: number; stderr: string; usedLegacy: boolean }> {
  const base = [
    "pkcs12", "-in", pfxFile, "-passin", "env:PFX_PASSWORD",
    ...extractArgs, "-out", outPath
  ];
  const env = { PFX_PASSWORD: pfxPassword };

  if (forceLegacy === true) {
    const r = await runOpenssl([...base, "-legacy"], { env });
    return { exitCode: r.exitCode, stderr: r.stderr, usedLegacy: true };
  }
  if (forceLegacy === false) {
    const r = await runOpenssl(base, { env });
    return { exitCode: r.exitCode, stderr: r.stderr, usedLegacy: false };
  }
  // auto
  const first = await runOpenssl(base, { env });
  if (first.exitCode === 0) return { exitCode: 0, stderr: first.stderr, usedLegacy: false };
  const kind = classifyError(first.stderr);
  if (kind === "legacy") {
    const second = await runOpenssl([...base, "-legacy"], { env });
    return { exitCode: second.exitCode, stderr: second.stderr, usedLegacy: true };
  }
  return { exitCode: first.exitCode, stderr: first.stderr, usedLegacy: false };
}

export async function viewPkcs12(
  params: ViewRequest,
  workDirOverride?: string
): Promise<OperationResult<Pkcs12ViewResult>> {
  const fileCheck = validateFilePath(params.pfxFile);
  if (!fileCheck.ok) {
    log.warn("view: invalid input", { field: "pfxFile", reason: fileCheck.reason });
    return { success: false, message: "error.invalidInput" };
  }
  const pwCheck = validatePassword(params.pfxPassword);
  if (!pwCheck.ok) {
    log.warn("view: invalid input", { field: "pfxPassword", reason: pwCheck.reason });
    return { success: false, message: "error.invalidInput" };
  }

  const workDir = workDirOverride ?? resolveWorkDir();
  const tmp = new TempFileManager({ workDir });
  tmp.ensureWorkDir();

  const forceLegacy =
    params.legacyMode === "on" ? true :
    params.legacyMode === "off" ? false :
    undefined;

  try {
    const keyTmp = tmp.createTempFile("key.pem");
    const certTmp = tmp.createTempFile("certs.pem");

    const certsRes = await probeAndExtract(
      params.pfxFile, params.pfxPassword, forceLegacy,
      ["-nokeys"], certTmp
    );
    if (certsRes.exitCode !== 0) {
      const kind = classifyError(certsRes.stderr);
      if (kind === "password") {
        return { success: false, message: "error.passwordIncorrect" };
      }
      log.error("view: openssl failed", { step: "readPfx", exitCode: certsRes.exitCode, stderrHead: certsRes.stderr.slice(0, 200) });
      return { success: false, message: "error.opensslFailed" };
    }

    const keyRes = await probeAndExtract(
      params.pfxFile, params.pfxPassword, certsRes.usedLegacy ? true : forceLegacy,
      ["-nocerts", "-noenc"], keyTmp
    );
    // Missing private key in the pfx is allowed — result.privateKey stays undefined.
    let privateKey = undefined as Pkcs12ViewResult["privateKey"];
    if (keyRes.exitCode === 0) {
      const keyText = await parseKeyInfo(keyTmp);
      if (keyText.exitCode === 0) {
        privateKey = parsePrivateKeyInfo(keyText.stdout);
        const fp = await publicKeyFingerprintFromKey(keyTmp);
        if (fp) privateKey.publicKeySha256 = fp;
      }
    }

    // Parse each cert block individually via `openssl x509 -text` to fill
    // structured CertificateInfo.
    const allCertsPem = await readFile(certTmp, "utf8");
    const blocks = splitPemCerts(allCertsPem);
    const parsedCerts: CertificateInfo[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const path = tmp.createTempFile(`cert-${i}.pem`);
      await writeFile(path, blocks[i].endsWith("\n") ? blocks[i] : `${blocks[i]}\n`);
      const textRes = await parseCertificateText(path);
      if (textRes.exitCode !== 0) continue;
      const info = parseCertInfo(textRes.stdout);
      const fp = await publicKeyFingerprintFromCert(path);
      if (fp) info.publicKeySha256 = fp;
      parsedCerts.push(info);
    }

    // First cert in a PKCS#12 bag is conventionally the leaf; the rest form
    // the chain. This matches OpenSSL's output ordering for `pkcs12 -nokeys`.
    const [serverCert, ...chainCerts] = parsedCerts;

    const result: Pkcs12ViewResult = { privateKey, serverCert, chainCerts };
    log.info("view done", { pfx: params.pfxFile, chainLen: chainCerts.length, hasKey: !!privateKey });
    return { success: true, message: "common.viewSucceeded", details: result };
  } catch (err) {
    log.error("view failed", { pfx: params.pfxFile }, err);
    return { success: false, message: "error.unknown" };
  } finally {
    tmp.cleanup();
  }
}
