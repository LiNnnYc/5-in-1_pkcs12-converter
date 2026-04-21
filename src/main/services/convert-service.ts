import { existsSync, rmSync } from "node:fs";
import type {
  AliasEntry,
  JksToP12Request,
  P12ToJksRequest,
  ListAliasesRequest,
  OperationResult,
  OperationWarning
} from "../../types";
import { validateFilePath, validateOutputPath, validatePassword, validateKeystorePassword } from "../utils/sanitizer";
import { listAliases, listAliasEntries, runKeytool } from "../engines/keytool-runner";
import { runOpenssl } from "../engines/openssl-runner";
import { classifyError } from "../engines/output-parser";
import { mapError } from "./error-mapper";
import { createLogger } from "../utils/logger";
import { TempFileManager } from "../utils/temp-file";
import { resolveWorkDir } from "../utils/path-resolver";

const log = createLogger("convert");

// M2 spec: P12→JKS always imports into a single destination alias "1".
// This keeps the output keystore shape predictable for downstream tooling.
const P12_TO_JKS_DEST_ALIAS = "1";

// Remove any leftover output file so keytool -importkeystore doesn't silently
// append into an existing keystore (that would mix entries across runs).
function clearOutput(path: string): void {
  try { rmSync(path, { force: true }); } catch { /* best effort */ }
}

export async function listKeystoreAliases(
  params: ListAliasesRequest
): Promise<OperationResult<{ aliases: AliasEntry[] }>> {
  const f = validateFilePath(params.keystoreFile);
  if (!f.ok) {
    log.warn("listAliases: invalid input", { field: "keystoreFile", reason: f.reason });
    return { success: false, message: "error.invalidInput" };
  }
  const pw = validatePassword(params.keystorePassword);
  if (!pw.ok) {
    log.warn("listAliases: invalid input", { field: "keystorePassword", reason: pw.reason });
    return { success: false, message: "error.invalidInput" };
  }

  try {
    const aliases = await listAliasEntries(params.keystoreFile, params.keystorePassword, params.storeType);
    log.info("listAliases done", {
      keystore: params.keystoreFile,
      storeType: params.storeType,
      count: aliases.length,
      types: aliases.map((a) => a.entryType)
    });
    return { success: true, message: "common.aliasesListed", details: { aliases } };
  } catch (err) {
    log.error("listAliases failed", { keystore: params.keystoreFile }, err);
    const mapped = mapError((err as Error).message);
    // Surface password-incorrect (and other specific causes) straight through;
    // fall back to the generic list-aliases error only for genuinely unknown cases.
    const key = mapped.i18nKey === "error.unknown" ? "error.listAliasesFailed" : mapped.i18nKey;
    return { success: false, message: key };
  }
}

export async function jksToP12(params: JksToP12Request): Promise<OperationResult> {
  const fileCheck = validateFilePath(params.jksFile);
  if (!fileCheck.ok) return { success: false, message: "error.invalidInput", details: { field: "jksFile", reason: fileCheck.reason } };
  const inPw = validateKeystorePassword(params.jksPassword);
  if (!inPw.ok) return { success: false, message: "error.invalidInput", details: { field: "jksPassword", reason: inPw.reason } };
  const outPw = validateKeystorePassword(params.outputPassword);
  if (!outPw.ok) return { success: false, message: "error.invalidInput", details: { field: "outputPassword", reason: outPw.reason } };
  const outCheck = validateOutputPath(params.outputFile);
  if (!outCheck.ok) return { success: false, message: "error.invalidInput", details: { field: "outputFile", reason: outCheck.reason } };

  const warnings: OperationWarning[] = [];

  // Probe aliases first so we can surface a JKS_MULTIPLE_ALIASES warning when
  // the user didn't pick one. This is a confirmation-required warning because
  // silently picking the first alias would lose entries the user cares about.
  let aliases: string[];
  try {
    aliases = await listAliases(params.jksFile, params.jksPassword, "JKS");
  } catch (err) {
    log.error("jksToP12 alias probe failed", { jks: params.jksFile }, err);
    const mapped = mapError((err as Error).message);
    const key = mapped.i18nKey === "error.unknown" ? "error.listAliasesFailed" : mapped.i18nKey;
    return { success: false, message: key, details: { error: (err as Error).message } };
  }

  if (aliases.length === 0) {
    return { success: false, message: "error.keystoreEmpty" };
  }

  let chosenAlias: string | undefined = params.aliasFilter;
  if (aliases.length > 1 && !chosenAlias) {
    warnings.push({
      code: "JKS_MULTIPLE_ALIASES",
      message: `JKS contains ${aliases.length} aliases; pick one before converting.`,
      requiresConfirmation: true,
      details: { aliases }
    });
    return {
      success: false,
      message: "error.aliasSelectionRequired",
      warnings,
      requiresConfirmation: true
    };
  }
  if (chosenAlias) {
    // Keytool alias comparison is case-insensitive; mirror that here so users
    // who type "Beta" match "beta" in the keystore.
    const match = aliases.find((a) => a.toLowerCase() === chosenAlias!.toLowerCase());
    if (!match) {
      return { success: false, message: "error.aliasNotFound", details: { alias: chosenAlias } };
    }
    chosenAlias = match;
  } else {
    chosenAlias = aliases[0];
  }

  clearOutput(params.outputFile);

  const args = [
    "-importkeystore",
    "-srckeystore", params.jksFile,
    "-srcstoretype", "JKS",
    "-destkeystore", params.outputFile,
    "-deststoretype", "PKCS12",
    "-srcstorepass:env", "STORE_PASSWORD",
    "-srckeypass:env", "STORE_PASSWORD",
    "-deststorepass:env", "NEW_STORE_PASSWORD",
    "-destkeypass:env", "NEW_STORE_PASSWORD",
    "-srcalias", chosenAlias,
    "-noprompt"
  ];
  const r = await runKeytool(args, {
    env: {
      STORE_PASSWORD: params.jksPassword,
      NEW_STORE_PASSWORD: params.outputPassword
    }
  });
  if (r.exitCode !== 0) {
    log.error("jksToP12 failed", { exitCode: r.exitCode, stderrHead: r.stderr.slice(0, 200) });
    clearOutput(params.outputFile);
    return {
      success: false,
      message: "error.keytoolFailed",
      details: { exitCode: r.exitCode, stderr: r.stderr }
    };
  }

  // Verify the output P12 is actually readable by OpenSSL. Guards against
  // keytool writing a keystore that downstream OpenSSL-based tools (including
  // our own extract/view services) can't open.
  const verify = await runOpenssl([
    "pkcs12", "-in", params.outputFile, "-nokeys", "-noout",
    "-passin", "env:PFX_PASSWORD"
  ], { env: { PFX_PASSWORD: params.outputPassword } });
  if (verify.exitCode !== 0) {
    log.warn("jksToP12 output failed openssl verification", { stderrHead: verify.stderr.slice(0, 200) });
    clearOutput(params.outputFile);
    return {
      success: false,
      message: "error.verificationFailed",
      details: { exitCode: verify.exitCode, stderr: verify.stderr }
    };
  }

  log.info("jksToP12 done", { alias: chosenAlias, output: params.outputFile });
  return {
    success: true,
    message: "common.jksToP12Succeeded",
    outputFiles: [params.outputFile],
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

// Repackage a legacy (PBE-SHA1-3DES) PKCS#12 as a modern AES-256-CBC one so
// downstream keytool — which refuses to parse the legacy algorithm — can read
// it. Writes to a caller-owned TempFileManager; returns the path to the new
// PFX, or null if any openssl step failed. The repackaged bundle collapses
// alias metadata to a single entry named "1" (matches P12→JKS dest alias,
// since this service already fixes dest to "1" anyway).
async function repackageLegacyPfxAsAes(
  pfxFile: string,
  pfxPassword: string,
  tmp: TempFileManager
): Promise<string | null> {
  const bundle = tmp.createTempFile("legacy-bundle.pem");
  const out = tmp.createTempFile("legacy-repackaged.p12");
  const env = { IN_PW: pfxPassword, OUT_PW: pfxPassword };
  const dump = await runOpenssl([
    "pkcs12", "-in", pfxFile, "-legacy", "-nodes",
    "-passin", "env:IN_PW",
    "-out", bundle
  ], { env });
  if (dump.exitCode !== 0) {
    log.warn("legacy repackage: dump failed", { stderrHead: dump.stderr.slice(0, 200) });
    return null;
  }
  const repack = await runOpenssl([
    "pkcs12", "-export", "-in", bundle,
    "-passout", "env:OUT_PW",
    "-keypbe", "aes-256-cbc", "-certpbe", "aes-256-cbc",
    "-macalg", "sha256",
    "-name", "1",
    "-out", out
  ], { env });
  if (repack.exitCode !== 0) {
    log.warn("legacy repackage: re-export failed", { stderrHead: repack.stderr.slice(0, 200) });
    return null;
  }
  return out;
}

export async function p12ToJks(params: P12ToJksRequest): Promise<OperationResult> {
  const fileCheck = validateFilePath(params.pfxFile);
  if (!fileCheck.ok) return { success: false, message: "error.invalidInput", details: { field: "pfxFile", reason: fileCheck.reason } };
  const inPw = validateKeystorePassword(params.pfxPassword);
  if (!inPw.ok) return { success: false, message: "error.invalidInput", details: { field: "pfxPassword", reason: inPw.reason } };
  const outPw = validateKeystorePassword(params.outputPassword);
  if (!outPw.ok) return { success: false, message: "error.invalidInput", details: { field: "outputPassword", reason: outPw.reason } };
  const outCheck = validateOutputPath(params.outputFile);
  if (!outCheck.ok) return { success: false, message: "error.invalidInput", details: { field: "outputFile", reason: outCheck.reason } };

  // Legacy PKCS#12 (PBE-SHA1-3DES) can be rejected by modern Keytool. Probe
  // via OpenSSL first; if legacy is detected, transparently repackage the
  // source as an AES PKCS#12 using a bundled temp dir and feed that to
  // keytool. Password stays the same across the repackage so callers don't
  // see the transition.
  const probe = await runOpenssl([
    "pkcs12", "-in", params.pfxFile, "-nokeys", "-noout",
    "-passin", "env:PFX_PASSWORD"
  ], { env: { PFX_PASSWORD: params.pfxPassword } });

  let activePfxFile = params.pfxFile;
  let legacyTmp: TempFileManager | null = null;
  let wasRepackaged = false;

  if (probe.exitCode !== 0) {
    const kind = classifyError(probe.stderr);
    if (kind === "password") {
      return { success: false, message: "error.passwordIncorrect" };
    }
    if (kind === "legacy") {
      legacyTmp = new TempFileManager({ workDir: resolveWorkDir() });
      legacyTmp.ensureWorkDir();
      log.info("p12ToJks: legacy PFX detected — auto-repackaging as AES");
      const repackaged = await repackageLegacyPfxAsAes(params.pfxFile, params.pfxPassword, legacyTmp);
      if (!repackaged) {
        legacyTmp.cleanup();
        return { success: false, message: "error.legacyP12RequiresRemerge" };
      }
      activePfxFile = repackaged;
      wasRepackaged = true;
    }
    // fall through on unknown errors: let keytool try anyway; it may still succeed.
  }

  try {
    return await convertP12ToJksWithSource(params, activePfxFile, wasRepackaged);
  } finally {
    legacyTmp?.cleanup();
  }
}

async function convertP12ToJksWithSource(
  params: P12ToJksRequest,
  activePfxFile: string,
  wasRepackaged: boolean
): Promise<OperationResult> {
  // Probe source aliases. When the PFX carries more than one, force the user
  // to pick exactly one — P12→JKS fixes dest alias to "1" so converting all
  // entries in one shot would be meaningless (only the last import survives).
  let srcAliases: string[];
  try {
    srcAliases = await listAliases(activePfxFile, params.pfxPassword, "PKCS12");
  } catch (err) {
    log.error("p12ToJks alias probe failed", { pfx: activePfxFile }, err);
    const mapped = mapError((err as Error).message);
    const key = mapped.i18nKey === "error.unknown" ? "error.listAliasesFailed" : mapped.i18nKey;
    return { success: false, message: key, details: { error: (err as Error).message } };
  }
  if (srcAliases.length === 0) {
    return { success: false, message: "error.keystoreEmpty" };
  }

  const pfxWarnings: OperationWarning[] = [];
  let srcAlias: string;
  if (srcAliases.length > 1 && !params.aliasFilter) {
    pfxWarnings.push({
      code: "PKCS12_MULTIPLE_ALIASES",
      message: `PFX contains ${srcAliases.length} aliases; pick one before converting.`,
      requiresConfirmation: true,
      details: { aliases: srcAliases }
    });
    return {
      success: false,
      message: "error.aliasSelectionRequired",
      warnings: pfxWarnings,
      requiresConfirmation: true
    };
  }
  if (params.aliasFilter) {
    const match = srcAliases.find((a) => a.toLowerCase() === params.aliasFilter!.toLowerCase());
    if (!match) {
      return { success: false, message: "error.aliasNotFound", details: { alias: params.aliasFilter } };
    }
    srcAlias = match;
  } else {
    srcAlias = srcAliases[0];
  }

  clearOutput(params.outputFile);

  const args = [
    "-importkeystore",
    "-srckeystore", activePfxFile,
    "-srcstoretype", "PKCS12",
    "-destkeystore", params.outputFile,
    "-deststoretype", "JKS",
    "-srcstorepass:env", "STORE_PASSWORD",
    "-srckeypass:env", "STORE_PASSWORD",
    "-deststorepass:env", "NEW_STORE_PASSWORD",
    "-destkeypass:env", "NEW_STORE_PASSWORD",
    "-srcalias", srcAlias,
    "-destalias", P12_TO_JKS_DEST_ALIAS,
    "-noprompt"
  ];
  const r = await runKeytool(args, {
    env: {
      STORE_PASSWORD: params.pfxPassword,
      NEW_STORE_PASSWORD: params.outputPassword
    }
  });
  if (r.exitCode !== 0) {
    log.error("p12ToJks failed", { exitCode: r.exitCode, stderrHead: r.stderr.slice(0, 200) });
    clearOutput(params.outputFile);
    return {
      success: false,
      message: "error.keytoolFailed",
      details: { exitCode: r.exitCode, stderr: r.stderr }
    };
  }

  // Verify: open the JKS with keytool -list.
  if (!existsSync(params.outputFile)) {
    return { success: false, message: "error.outputNotCreated" };
  }
  try {
    const outAliases = await listAliases(params.outputFile, params.outputPassword, "JKS");
    if (!outAliases.map((a) => a.toLowerCase()).includes(P12_TO_JKS_DEST_ALIAS)) {
      log.warn("p12ToJks output missing expected alias", { expected: P12_TO_JKS_DEST_ALIAS, got: outAliases });
    }
  } catch (err) {
    clearOutput(params.outputFile);
    return { success: false, message: "error.verificationFailed", details: { error: (err as Error).message } };
  }

  log.info("p12ToJks done", { srcAlias, output: params.outputFile, wasRepackaged });
  return {
    success: true,
    message: "common.p12ToJksSucceeded",
    outputFiles: [params.outputFile]
  };
}
