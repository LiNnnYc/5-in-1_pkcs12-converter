import { existsSync, rmSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import type {
  AliasEntry,
  JksToP12Request,
  P12ToJksRequest,
  ListAliasesRequest,
  OperationResult,
  OperationWarning
} from "../../types";
import { validateFilePath, validateOutputPath, validatePassword, validateKeystorePassword, validationErrorKey } from "../utils/sanitizer";
import { listAliases, listAliasEntries, runKeytool } from "../engines/keytool-runner";
import { runOpenssl } from "../engines/openssl-runner";
import { classifyError } from "../engines/output-parser";
import { mapError } from "./error-mapper";
import { createLogger } from "../utils/logger";
import { TempFileManager } from "../utils/temp-file";
import { resolveWorkDir } from "../utils/path-resolver";
import { withSafeOutputPath, containsNonAscii } from "../utils/safe-path";

const log = createLogger("convert");

// M2 spec: P12→JKS always imports into a single destination alias "1".
// This keeps the output keystore shape predictable for downstream tooling.
const P12_TO_JKS_DEST_ALIAS = "1";

// Remove any leftover output file so keytool -importkeystore doesn't silently
// append into an existing keystore (that would mix entries across runs).
function clearOutput(path: string): void {
  try { rmSync(path, { force: true }); } catch { /* best effort */ }
}

// Stage a user-supplied keystore (or any file) into .work/ under an ASCII name.
// keytool / openssl on Windows can mishandle non-ASCII source paths; copying via
// Node fs (which uses Win32 wide-char APIs) sidesteps the problem.
async function stageInputForCli(userPath: string, tmp: TempFileManager, label: string): Promise<string> {
  if (!containsNonAscii(userPath)) return userPath;
  const ext = pickExt(userPath);
  const staged = tmp.createTempFile(`${label}${ext}`);
  await copyFile(userPath, staged);
  return staged;
}

function pickExt(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = p.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  const ext = base.slice(dot);
  return containsNonAscii(ext) ? "" : ext;
}

export async function listKeystoreAliases(
  params: ListAliasesRequest
): Promise<OperationResult<{ aliases: AliasEntry[] }>> {
  const f = validateFilePath(params.keystoreFile);
  if (!f.ok) {
    log.warn("listAliases: invalid input", { field: "keystoreFile", reason: f.reason });
    return { success: false, message: validationErrorKey(f) };
  }
  const pw = validatePassword(params.keystorePassword);
  if (!pw.ok) {
    log.warn("listAliases: invalid input", { field: "keystorePassword", reason: pw.reason });
    return { success: false, message: validationErrorKey(pw) };
  }

  // Stage non-ASCII keystore paths through .work/ so keytool's JVM-side path
  // handling (which is usually fine) and OpenSSL fallbacks both see ASCII paths.
  const tmp = new TempFileManager({ workDir: resolveWorkDir() });
  tmp.ensureWorkDir();
  try {
    const staged = await stageInputForCli(params.keystoreFile, tmp, "keystore");
    const aliases = await listAliasEntries(staged, params.keystorePassword, params.storeType);
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
  } finally {
    tmp.cleanup();
  }
}

export async function jksToP12(params: JksToP12Request): Promise<OperationResult> {
  const fileCheck = validateFilePath(params.jksFile);
  if (!fileCheck.ok) return { success: false, message: validationErrorKey(fileCheck), details: { field: "jksFile", reason: fileCheck.reason } };
  const inPw = validateKeystorePassword(params.jksPassword);
  if (!inPw.ok) return { success: false, message: validationErrorKey(inPw), details: { field: "jksPassword", reason: inPw.reason } };
  const outPw = validateKeystorePassword(params.outputPassword);
  if (!outPw.ok) return { success: false, message: validationErrorKey(outPw), details: { field: "outputPassword", reason: outPw.reason } };
  const outCheck = validateOutputPath(params.outputFile);
  if (!outCheck.ok) return { success: false, message: validationErrorKey(outCheck), details: { field: "outputFile", reason: outCheck.reason } };

  const warnings: OperationWarning[] = [];

  // All keytool / openssl invocations run against ASCII-only paths under .work/.
  // Stage the input JKS (if user path is non-ASCII) and route the output PFX
  // through `withSafeOutputPath` so neither tool sees the user's CJK / emoji path.
  const tmp = new TempFileManager({ workDir: resolveWorkDir() });
  tmp.ensureWorkDir();
  try {
    const stagedJks = await stageInputForCli(params.jksFile, tmp, "src.jks");

    // Probe aliases first so we can surface a JKS_MULTIPLE_ALIASES warning when
    // the user didn't pick one. This is a confirmation-required warning because
    // silently picking the first alias would lose entries the user cares about.
    let aliases: string[];
    try {
      aliases = await listAliases(stagedJks, params.jksPassword, "JKS");
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

    const conversion = await withSafeOutputPath(params.outputFile, resolveWorkDir(), async (asciiOut) => {
      const args = [
        "-importkeystore",
        "-srckeystore", stagedJks,
        "-srcstoretype", "JKS",
        "-destkeystore", asciiOut,
        "-deststoretype", "PKCS12",
        "-srcstorepass:env", "STORE_PASSWORD",
        "-srckeypass:env", "STORE_PASSWORD",
        "-deststorepass:env", "NEW_STORE_PASSWORD",
        "-destkeypass:env", "NEW_STORE_PASSWORD",
        "-srcalias", chosenAlias!,
        "-noprompt"
      ];
      const r = await runKeytool(args, {
        env: {
          STORE_PASSWORD: params.jksPassword,
          NEW_STORE_PASSWORD: params.outputPassword
        }
      });
      if (r.exitCode !== 0) {
        return { ok: false as const, exitCode: r.exitCode, stderr: r.stderr };
      }

      // Verify the freshly-written P12 is readable by OpenSSL while it's still
      // sitting at an ASCII path; this catches malformed output before we
      // rename to the user-chosen target.
      const verify = await runOpenssl([
        "pkcs12", "-in", asciiOut, "-nokeys", "-noout",
        "-passin", "env:PFX_PASSWORD"
      ], { env: { PFX_PASSWORD: params.outputPassword } });
      if (verify.exitCode !== 0) {
        return { ok: false as const, verifyFailed: true, exitCode: verify.exitCode, stderr: verify.stderr };
      }
      return { ok: true as const };
    });

    if (!conversion.ok) {
      clearOutput(params.outputFile);
      if ("verifyFailed" in conversion && conversion.verifyFailed) {
        log.warn("jksToP12 output failed openssl verification", { stderrHead: conversion.stderr.slice(0, 200) });
        return { success: false, message: "error.verificationFailed", details: { exitCode: conversion.exitCode, stderr: conversion.stderr } };
      }
      log.error("jksToP12 failed", { exitCode: conversion.exitCode, stderrHead: conversion.stderr.slice(0, 200) });
      return { success: false, message: "error.keytoolFailed", details: { exitCode: conversion.exitCode, stderr: conversion.stderr } };
    }

    log.info("jksToP12 done", { alias: chosenAlias, output: params.outputFile });
    return {
      success: true,
      message: "common.jksToP12Succeeded",
      outputFiles: [params.outputFile],
      warnings: warnings.length > 0 ? warnings : undefined
    };
  } finally {
    tmp.cleanup();
  }
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
  // pfxFile is expected to already be an ASCII-staged path (caller stages user
  // input before calling). bundle/out live under .work/ so paths are safe.
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
  if (!fileCheck.ok) return { success: false, message: validationErrorKey(fileCheck), details: { field: "pfxFile", reason: fileCheck.reason } };
  const inPw = validateKeystorePassword(params.pfxPassword);
  if (!inPw.ok) return { success: false, message: validationErrorKey(inPw), details: { field: "pfxPassword", reason: inPw.reason } };
  const outPw = validateKeystorePassword(params.outputPassword);
  if (!outPw.ok) return { success: false, message: validationErrorKey(outPw), details: { field: "outputPassword", reason: outPw.reason } };
  const outCheck = validateOutputPath(params.outputFile);
  if (!outCheck.ok) return { success: false, message: validationErrorKey(outCheck), details: { field: "outputFile", reason: outCheck.reason } };

  // Stage the input PFX into .work/ so neither openssl nor keytool ever sees
  // the user's potentially non-ASCII path.
  const stageTmp = new TempFileManager({ workDir: resolveWorkDir() });
  stageTmp.ensureWorkDir();
  const stagedPfx = await stageInputForCli(params.pfxFile, stageTmp, "src.pfx");

  // Legacy PKCS#12 (PBE-SHA1-3DES) can be rejected by modern Keytool. Probe
  // via OpenSSL first; if legacy is detected, transparently repackage the
  // source as an AES PKCS#12 using a bundled temp dir and feed that to
  // keytool. Password stays the same across the repackage so callers don't
  // see the transition.
  const probe = await runOpenssl([
    "pkcs12", "-in", stagedPfx, "-nokeys", "-noout",
    "-passin", "env:PFX_PASSWORD"
  ], { env: { PFX_PASSWORD: params.pfxPassword } });

  let activePfxFile = stagedPfx;
  let legacyTmp: TempFileManager | null = null;
  let wasRepackaged = false;

  if (probe.exitCode !== 0) {
    const kind = classifyError(probe.stderr);
    if (kind === "password") {
      stageTmp.cleanup();
      return { success: false, message: "error.passwordIncorrect" };
    }
    if (kind === "legacy") {
      legacyTmp = new TempFileManager({ workDir: resolveWorkDir() });
      legacyTmp.ensureWorkDir();
      log.info("p12ToJks: legacy PFX detected — auto-repackaging as AES");
      const repackaged = await repackageLegacyPfxAsAes(stagedPfx, params.pfxPassword, legacyTmp);
      if (!repackaged) {
        legacyTmp.cleanup();
        stageTmp.cleanup();
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
    stageTmp.cleanup();
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

  const conversion = await withSafeOutputPath(params.outputFile, resolveWorkDir(), async (asciiOut) => {
    const args = [
      "-importkeystore",
      "-srckeystore", activePfxFile,
      "-srcstoretype", "PKCS12",
      "-destkeystore", asciiOut,
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
      return { ok: false as const, exitCode: r.exitCode, stderr: r.stderr };
    }
    if (!existsSync(asciiOut)) {
      return { ok: false as const, missing: true, exitCode: r.exitCode, stderr: r.stderr };
    }
    // Verify the freshly-written JKS by listing its aliases at the ASCII path
    // before we rename. listAliases verifies the keystore opens & MAC matches.
    try {
      const outAliases = await listAliases(asciiOut, params.outputPassword, "JKS");
      if (!outAliases.map((a) => a.toLowerCase()).includes(P12_TO_JKS_DEST_ALIAS)) {
        log.warn("p12ToJks output missing expected alias", { expected: P12_TO_JKS_DEST_ALIAS, got: outAliases });
      }
    } catch (err) {
      return { ok: false as const, verifyError: (err as Error).message };
    }
    return { ok: true as const };
  });

  if (!conversion.ok) {
    clearOutput(params.outputFile);
    if ("missing" in conversion && conversion.missing) {
      return { success: false, message: "error.outputNotCreated" };
    }
    if ("verifyError" in conversion) {
      return { success: false, message: "error.verificationFailed", details: { error: conversion.verifyError } };
    }
    log.error("p12ToJks failed", { exitCode: conversion.exitCode, stderrHead: conversion.stderr.slice(0, 200) });
    return { success: false, message: "error.keytoolFailed", details: { exitCode: conversion.exitCode, stderr: conversion.stderr } };
  }

  log.info("p12ToJks done", { srcAlias, output: params.outputFile, wasRepackaged });
  return {
    success: true,
    message: "common.p12ToJksSucceeded",
    outputFiles: [params.outputFile]
  };
}
