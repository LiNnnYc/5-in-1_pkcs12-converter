import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtractRequest, LegacyMode, OperationResult, OperationWarning } from "../../types";
import { validateFilePath, validateOutputDir, validatePassword } from "../utils/sanitizer";
import { TempFileManager } from "../utils/temp-file";
import { resolveWorkDir } from "../utils/path-resolver";
import { runOpenssl } from "../engines/openssl-runner";
import { classifyError, splitPemCerts } from "../engines/output-parser";
import { createLogger } from "../utils/logger";

const log = createLogger("extract");

type LegacyDecision = {
  useLegacy: boolean;
  uncertain: boolean; // caller should emit LEGACY_MODE_UNCERTAIN warning
};

async function probeLegacy(pfxFile: string, pfxPassword: string): Promise<LegacyDecision> {
  // Try a lightweight "info" probe without -legacy first.
  const probe = await runOpenssl([
    "pkcs12", "-in", pfxFile, "-nokeys", "-noout",
    "-passin", "env:PFX_PASSWORD"
  ], { env: { PFX_PASSWORD: pfxPassword } });

  if (probe.exitCode === 0) return { useLegacy: false, uncertain: false };

  const kind = classifyError(probe.stderr);
  if (kind === "legacy") return { useLegacy: true, uncertain: false };
  if (kind === "password") {
    // Surface as exception-like sentinel so caller converts to user-facing error.
    throw new Error("PASSWORD_ERROR");
  }
  return { useLegacy: false, uncertain: true };
}

function pkcs12Args(base: string[], useLegacy: boolean): string[] {
  return useLegacy ? [...base, "-legacy"] : base;
}

async function runExtract(
  pfxFile: string,
  pfxPassword: string,
  extraArgs: string[],
  outPath: string,
  useLegacy: boolean
): Promise<{ exitCode: number; stderr: string }> {
  const base = [
    "pkcs12", "-in", pfxFile, "-passin", "env:PFX_PASSWORD",
    ...extraArgs, "-out", outPath
  ];
  const r = await runOpenssl(pkcs12Args(base, useLegacy), {
    env: { PFX_PASSWORD: pfxPassword }
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
  if (!fileCheck.ok) return { success: false, message: "error.invalidInput", details: { field: "pfxFile", reason: fileCheck.reason } };
  const pwCheck = validatePassword(params.pfxPassword);
  if (!pwCheck.ok) return { success: false, message: "error.invalidInput", details: { field: "pfxPassword", reason: pwCheck.reason } };
  const dirCheck = validateOutputDir(params.outputDir);
  if (!dirCheck.ok) return { success: false, message: "error.invalidInput", details: { field: "outputDir", reason: dirCheck.reason } };

  const workDir = workDirOverride ?? resolveWorkDir();
  const tmp = new TempFileManager({ workDir });
  tmp.ensureWorkDir();

  let probed: LegacyDecision | undefined;
  if (params.legacyMode === "auto") {
    try {
      probed = await probeLegacy(params.pfxFile, params.pfxPassword);
    } catch (err) {
      if ((err as Error).message === "PASSWORD_ERROR") {
        tmp.cleanup();
        return { success: false, message: "error.passwordIncorrect" };
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
      params.pfxFile, params.pfxPassword,
      ["-nocerts", "-noenc"], keyTmp, decision.useLegacy
    );
    if (keyRes.exitCode !== 0) {
      const kind = classifyError(keyRes.stderr);
      if (kind === "password") return { success: false, message: "error.passwordIncorrect", warnings };
      return {
        success: false,
        message: "error.opensslFailed",
        details: { step: "extractKey", exitCode: keyRes.exitCode, stderr: keyRes.stderr },
        warnings
      };
    }

    // Step 2: server (leaf) cert
    const serverRes = await runExtract(
      params.pfxFile, params.pfxPassword,
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
      params.pfxFile, params.pfxPassword,
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
      if (serverBlocks.length > 0) {
        const serverOut = join(params.outputDir, "server.crt");
        await writeFile(serverOut, serverBlocks[0].endsWith("\n") ? serverBlocks[0] : `${serverBlocks[0]}\n`, "utf8");
        outputs.push(serverOut);
      }
      for (let i = 0; i < caBlocks.length; i++) {
        const caOut = join(params.outputDir, `ca-${i + 1}.crt`);
        await writeFile(caOut, caBlocks[i].endsWith("\n") ? caBlocks[i] : `${caBlocks[i]}\n`, "utf8");
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
    return { success: false, message: "error.unknown", details: { error: (err as Error).message } };
  } finally {
    tmp.cleanup();
  }
}
