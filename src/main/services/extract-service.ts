import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtractRequest, LegacyMode, OperationResult, OperationWarning } from "../../types";
import { validateFilePath, validateOutputDir, validatePassword, validationErrorKey } from "../utils/sanitizer";
import { TempFileManager } from "../utils/temp-file";
import { resolveWorkDir } from "../utils/path-resolver";
import { runOpenssl, parseCertificateText } from "../engines/openssl-runner";
import { readFileForOpenssl } from "../utils/safe-path";
import { classifyError, parseCertInfo, splitPemCerts } from "../engines/output-parser";
import { mapError } from "./error-mapper";
import { createLogger } from "../utils/logger";

const log = createLogger("extract");

type LegacyDecision = {
  useLegacy: boolean;
  uncertain: boolean; // caller should emit LEGACY_MODE_UNCERTAIN warning
};

async function probeLegacy(pfxBuf: Buffer, pfxPassword: string): Promise<LegacyDecision> {
  // Try a lightweight "info" probe without -legacy first. Pfx content is fed via
  // stdin so non-ASCII user paths cannot reach openssl.
  const probe = await runOpenssl([
    "pkcs12", "-nokeys", "-noout",
    "-passin", "env:PFX_PASSWORD"
  ], { env: { PFX_PASSWORD: pfxPassword }, stdin: pfxBuf });

  if (probe.exitCode === 0) return { useLegacy: false, uncertain: false };

  const kind = classifyError(probe.stderr);
  if (kind === "legacy") return { useLegacy: true, uncertain: false };
  if (kind === "password") {
    // Surface as exception-like sentinel so caller converts to user-facing error.
    throw new Error("PASSWORD_ERROR");
  }
  if (kind === "format") {
    // Non-PFX file (or corrupted) — don't pretend legacy might help, raise a
    // clear format-error sentinel so the UI shows "檔案格式無效" rather than
    // "OpenSSL failed" + a confusing LEGACY_MODE_UNCERTAIN warning.
    throw new Error("FORMAT_ERROR");
  }
  return { useLegacy: false, uncertain: true };
}

function pkcs12Args(base: string[], useLegacy: boolean): string[] {
  return useLegacy ? [...base, "-legacy"] : base;
}

// Pull CN from an openssl-formatted subject line. Handles both "CN=foo,O=..."
// and "CN = foo, O = ..." shapes, and quoted values "CN=\"foo, bar\"".
export function extractCnFromSubject(subject: string): string | undefined {
  const quoted = subject.match(/CN\s*=\s*"([^"]+)"/i);
  if (quoted) return quoted[1].trim() || undefined;
  const bare = subject.match(/CN\s*=\s*([^,/]+)/i);
  if (!bare) return undefined;
  return bare[1].trim() || undefined;
}

// Make a CN safe for filesystem use. Wildcards get mapped to "-" per user
// preference; other Windows-reserved chars also become "-". Whitespace →
// underscore. Trim to keep paths sane.
export function sanitizeCnForFilename(cn: string): string {
  const mapped = cn
    .replace(/\*/g, "-")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return mapped.slice(0, 80);
}

async function cnFromPemBlock(
  block: string,
  tmp: TempFileManager,
  tag: string
): Promise<string | undefined> {
  const path = tmp.createTempFile(`cn-${tag}.pem`);
  await writeFile(path, block.endsWith("\n") ? block : `${block}\n`, "utf8");
  const res = await parseCertificateText(path);
  if (res.exitCode !== 0) return undefined;
  const info = parseCertInfo(res.stdout);
  const cn = extractCnFromSubject(info.subject);
  if (!cn) return undefined;
  const sanitized = sanitizeCnForFilename(cn);
  return sanitized.length > 0 ? sanitized : undefined;
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  const name = `${base}-${i}`;
  used.add(name);
  return name;
}

async function runExtract(
  pfxBuf: Buffer,
  pfxPassword: string,
  extraArgs: string[],
  outPath: string,
  useLegacy: boolean
): Promise<{ exitCode: number; stderr: string }> {
  const base = [
    "pkcs12", "-passin", "env:PFX_PASSWORD",
    ...extraArgs, "-out", outPath
  ];
  const r = await runOpenssl(pkcs12Args(base, useLegacy), {
    env: { PFX_PASSWORD: pfxPassword },
    stdin: pfxBuf
  });
  return { exitCode: r.exitCode, stderr: r.stderr };
}

function decideLegacy(mode: LegacyMode, probed: LegacyDecision | undefined): { useLegacy: boolean; warning?: OperationWarning } {
  if (mode === "on") return { useLegacy: true };
  if (mode === "off") return { useLegacy: false };
  // auto
  if (!probed) return { useLegacy: false };
  if (probed.uncertain) {
    return {
      useLegacy: false,
      warning: {
        code: "LEGACY_MODE_UNCERTAIN",
        message: "Could not determine whether -legacy is needed; try toggling Legacy mode if extraction fails.",
        requiresConfirmation: false
      }
    };
  }
  return { useLegacy: probed.useLegacy };
}

export async function extractPkcs12(
  params: ExtractRequest,
  workDirOverride?: string
): Promise<OperationResult> {
  const fileCheck = validateFilePath(params.pfxFile);
  if (!fileCheck.ok) return { success: false, message: validationErrorKey(fileCheck), details: { field: "pfxFile", reason: fileCheck.reason } };
  const pwCheck = validatePassword(params.pfxPassword);
  if (!pwCheck.ok) return { success: false, message: validationErrorKey(pwCheck), details: { field: "pfxPassword", reason: pwCheck.reason } };
  const dirCheck = validateOutputDir(params.outputDir);
  if (!dirCheck.ok) return { success: false, message: validationErrorKey(dirCheck), details: { field: "outputDir", reason: dirCheck.reason } };

  const workDir = workDirOverride ?? resolveWorkDir();
  const tmp = new TempFileManager({ workDir });
  tmp.ensureWorkDir();

  // Read pfx into memory once and pipe to every openssl invocation via stdin
  // (avoids OpenSSL 3.x's non-ASCII path bug on Windows).
  let pfxBuf: Buffer;
  try {
    pfxBuf = await readFileForOpenssl(params.pfxFile);
  } catch (err) {
    tmp.cleanup();
    log.error("extract: pfx read failed", { pfx: params.pfxFile }, err);
    return { success: false, message: "error.fileNotFound", details: { field: "pfxFile", reason: (err as Error).message } };
  }

  let probed: LegacyDecision | undefined;
  if (params.legacyMode === "auto") {
    try {
      probed = await probeLegacy(pfxBuf, params.pfxPassword);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "PASSWORD_ERROR") {
        tmp.cleanup();
        return { success: false, message: "error.passwordIncorrect" };
      }
      if (msg === "FORMAT_ERROR") {
        tmp.cleanup();
        return { success: false, message: "error.formatInvalid" };
      }
      throw err;
    }
  }
  const decision = decideLegacy(params.legacyMode, probed);
  const warnings: OperationWarning[] = [];
  if (decision.warning) warnings.push(decision.warning);

  const keyTmp = tmp.createTempFile("private.key");
  const serverTmp = tmp.createTempFile("server.pem");
  const caTmp = tmp.createTempFile("ca.pem");

  try {
    // Step 1: private key (unencrypted, per spec)
    const keyRes = await runExtract(
      pfxBuf, params.pfxPassword,
      ["-nocerts", "-noenc"], keyTmp, decision.useLegacy
    );
    if (keyRes.exitCode !== 0) {
      const kind = classifyError(keyRes.stderr);
      if (kind === "password") return { success: false, message: "error.passwordIncorrect", warnings };
      if (kind === "format") return { success: false, message: "error.formatInvalid", warnings };
      return {
        success: false,
        message: "error.opensslFailed",
        details: { step: "extractKey", exitCode: keyRes.exitCode, stderr: keyRes.stderr },
        warnings
      };
    }

    // Step 2: server (leaf) cert
    const serverRes = await runExtract(
      pfxBuf, params.pfxPassword,
      ["-clcerts", "-nokeys"], serverTmp, decision.useLegacy
    );
    if (serverRes.exitCode !== 0) {
      return {
        success: false,
        message: "error.opensslFailed",
        details: { step: "extractServerCert", exitCode: serverRes.exitCode, stderr: serverRes.stderr },
        warnings
      };
    }

    // Step 3: CA chain certs (may be empty, which is OK)
    const caRes = await runExtract(
      pfxBuf, params.pfxPassword,
      ["-cacerts", "-nokeys"], caTmp, decision.useLegacy
    );
    if (caRes.exitCode !== 0) {
      return {
        success: false,
        message: "error.opensslFailed",
        details: { step: "extractCaCerts", exitCode: caRes.exitCode, stderr: caRes.stderr },
        warnings
      };
    }

    const serverPem = await readFile(serverTmp, "utf8");
    const caPem = existsSync(caTmp) ? await readFile(caTmp, "utf8") : "";
    const serverBlocks = splitPemCerts(serverPem);
    const caBlocks = splitPemCerts(caPem);

    await mkdir(params.outputDir, { recursive: true });
    const outputs: string[] = [];

    // Private key always written as private.key
    const keyOut = join(params.outputDir, "private.key");
    await copyFile(keyTmp, keyOut);
    outputs.push(keyOut);

    if (params.certOutputMode === "merged") {
      const mergedPath = join(params.outputDir, "certificates.pem");
      const merged = [...serverBlocks, ...caBlocks]
        .map((b) => (b.endsWith("\n") ? b : `${b}\n`))
        .join("");
      if (merged.length > 0) {
        await writeFile(mergedPath, merged, "utf8");
        outputs.push(mergedPath);
      }
    } else {
      const usedNames = new Set<string>();
      if (serverBlocks.length > 0) {
        const block = serverBlocks[0];
        const cn = await cnFromPemBlock(block, tmp, "server");
        const base = uniqueName(cn ?? "server", usedNames);
        const serverOut = join(params.outputDir, `${base}.crt`);
        await writeFile(serverOut, block.endsWith("\n") ? block : `${block}\n`, "utf8");
        outputs.push(serverOut);
      }
      for (let i = 0; i < caBlocks.length; i++) {
        const block = caBlocks[i];
        const cn = await cnFromPemBlock(block, tmp, `ca-${i}`);
        const base = uniqueName(cn ?? `ca-${i + 1}`, usedNames);
        const caOut = join(params.outputDir, `${base}.crt`);
        await writeFile(caOut, block.endsWith("\n") ? block : `${block}\n`, "utf8");
        outputs.push(caOut);
      }
    }

    log.info("extract done", {
      pfx: params.pfxFile,
      legacyMode: params.legacyMode,
      certOutputMode: params.certOutputMode,
      outputs
    });
    return {
      success: true,
      message: caBlocks.length === 0
        ? "common.extractSucceededNoChain"
        : "common.extractSucceeded",
      outputFiles: outputs,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  } catch (err) {
    log.error("extract failed", { pfx: params.pfxFile }, err);
    const e = err as NodeJS.ErrnoException;
    // Node fs errors during the final user-output writes (copyFile / writeFile)
    // surface here as ErrnoException. Map common ones to specific i18n keys so
    // users see "輸出資料夾無法寫入" instead of the generic "未知錯誤" that the
    // first round of M3 manual testing flagged for read-only output dirs.
    if (e?.code === "EACCES" || e?.code === "EPERM" || e?.code === "EROFS") {
      return { success: false, message: "error.outputNotWritable", details: { code: e.code } };
    }
    if (e?.code === "ENOENT") {
      return { success: false, message: "error.fileNotFound", details: { code: e.code } };
    }
    // Otherwise let mapError pick a reasonable key from the message text;
    // anything we don't recognize still falls through to error.unknown.
    const mapped = mapError(e?.message ?? "");
    return { success: false, message: mapped.i18nKey, details: { error: e?.message } };
  } finally {
    tmp.cleanup();
  }
}
