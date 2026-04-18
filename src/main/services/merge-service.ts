import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type {
  MergeRequest,
  MergePrecheckRequest,
  MergePrecheckResult,
  OperationResult,
  OperationWarning,
  NormalizedChainCert,
  DroppedCert,
  Pkcs12Algorithm,
  WarningCode
} from "../../types";
import { validateFilePath, validateOutputPath, validatePassword } from "../utils/sanitizer";
import { TempFileManager } from "../utils/temp-file";
import { resolveWorkDir } from "../utils/path-resolver";
import {
  checkKeyMatchesCert,
  runOpenssl
} from "../engines/openssl-runner";
import {
  parseCertificateFiles,
  deduplicateCerts,
  buildChain,
  generateChainWarnings,
  writeChainPem,
  type ParsedCert
} from "./chain-builder";
import { createLogger } from "../utils/logger";

const log = createLogger("merge");

// === Precheck token ===

// Token covers every file that influences the precheck result. If any of them
// changes between precheck and merge, the token becomes stale and we force a
// re-run so the user re-confirms warnings on the updated state.
export function computePrecheckToken(files: string[]): string {
  const h = createHash("sha256");
  for (const file of files) {
    const abs = resolve(file);
    const st = statSync(abs);
    h.update(abs);
    h.update("\0");
    h.update(String(st.size));
    h.update("\0");
    h.update(new Date(st.mtimeMs).toISOString());
    h.update("\0");
  }
  return h.digest("hex");
}

export function validatePrecheckToken(token: string, files: string[]): boolean {
  try {
    return computePrecheckToken(files) === token;
  } catch {
    return false;
  }
}

// Assemble the token-covered file list in a deterministic order.
function tokenFiles(p: MergePrecheckRequest): string[] {
  return [p.privateKeyFile, p.serverCertFile, ...p.chainCertFiles];
}

// === Input validation ===

type Invalid = { ok: false; message: string; details?: Record<string, unknown> };
type Valid = { ok: true };
type V = Valid | Invalid;

function validateInputs(p: MergePrecheckRequest): V {
  const files = [p.privateKeyFile, p.serverCertFile, ...p.chainCertFiles];
  for (const f of files) {
    const r = validateFilePath(f);
    if (!r.ok) {
      return { ok: false, message: "error.invalidInput", details: { field: "file", file: f, reason: r.reason } };
    }
  }
  if (p.privateKeyPassword !== undefined && p.privateKeyPassword !== "") {
    const r = validatePassword(p.privateKeyPassword);
    if (!r.ok) {
      return { ok: false, message: "error.invalidInput", details: { field: "privateKeyPassword", reason: r.reason } };
    }
  }
  return { ok: true };
}

// === Precheck ===

export async function mergePrecheck(
  params: MergePrecheckRequest,
  workDirOverride?: string
): Promise<OperationResult<MergePrecheckResult>> {
  const inputCheck = validateInputs(params);
  if (!inputCheck.ok) {
    log.warn("precheck: invalid input", inputCheck.details);
    return { success: false, message: inputCheck.message };
  }

  const workDir = workDirOverride ?? resolveWorkDir();
  const tmp = new TempFileManager({ workDir });
  tmp.ensureWorkDir();
  log.info("precheck start", {
    key: params.privateKeyFile,
    cert: params.serverCertFile,
    chainCount: params.chainCertFiles.length
  });
  try {
    const keyMatchesCert = await checkKeyMatchesCert(
      params.privateKeyFile,
      params.serverCertFile,
      params.privateKeyPassword
    );

    // Parse all chain input candidates.
    const chainParsed: ParsedCert[] = params.chainCertFiles.length > 0
      ? await parseCertificateFiles(params.chainCertFiles, workDir)
      : [];
    const [serverParsed] = await parseCertificateFiles([params.serverCertFile], workDir);

    const { unique, duplicates } = deduplicateCerts([serverParsed, ...chainParsed]);
    // Separate server from the rest after dedup.
    const uniqueWithoutServer = unique.filter(
      (c) => c.info.fingerprint.sha256 !== serverParsed.info.fingerprint.sha256
    );

    const buildResult = buildChain(serverParsed, [serverParsed, ...uniqueWithoutServer]);
    const warnings = generateChainWarnings(buildResult, chainParsed, duplicates);

    if (!keyMatchesCert) {
      // This is not a recoverable warning — caller must abort. Surface as error result.
      return {
        success: false,
        message: "error.keyMismatch",
        details: { keyMatchesCert, anchorCert: buildResult.anchor?.info } as unknown as MergePrecheckResult
      };
    }

    const normalizedChainCerts: NormalizedChainCert[] = buildResult.chain
      .filter((c) => c !== serverParsed)
      .map((c) => ({ cert: c.info, sourceFile: c.sourceFile }));

    const droppedChainCerts: DroppedCert[] = [
      ...duplicates.map((d) => ({ reason: "duplicate" as const, cert: d.info, sourceFile: d.sourceFile })),
      ...buildResult.unrelated.map((u) => ({ reason: "unrelated" as const, cert: u.info, sourceFile: u.sourceFile }))
    ];

    const precheckToken = computePrecheckToken(tokenFiles(params));

    const result: MergePrecheckResult = {
      precheckToken,
      keyMatchesCert,
      normalizedChainCerts,
      droppedChainCerts,
      anchorCert: buildResult.anchor?.info
    };

    log.info("precheck done", {
      warnings: warnings.map((w) => w.code),
      token: precheckToken.slice(0, 12)
    });
    return {
      success: true,
      message: "common.precheckCompleted",
      details: result,
      warnings,
      requiresConfirmation: warnings.some((w) => w.requiresConfirmation)
    };
  } catch (err) {
    log.error("precheck failed", undefined, err);
    return { success: false, message: "error.unknown" };
  } finally {
    tmp.cleanup();
  }
}

// === Merge execution ===

function buildPkcs12Args(opts: {
  algorithm: Pkcs12Algorithm;
  keyPath: string;
  certPath: string;
  chainPemPath?: string;
  outputPath: string;
  hasKeyPassword: boolean;
}): string[] {
  const args = [
    "pkcs12", "-export",
    "-inkey", opts.keyPath,
    "-in", opts.certPath,
    "-out", opts.outputPath,
    "-passout", "env:EXPORT_PASSWORD"
  ];
  if (opts.chainPemPath) {
    args.push("-certfile", opts.chainPemPath);
  }
  if (opts.hasKeyPassword) {
    args.push("-passin", "env:KEY_PASSWORD");
  }
  if (opts.algorithm === "AES-256-CBC") {
    args.push("-keypbe", "aes-256-cbc");
    args.push("-certpbe", "aes-256-cbc");
    args.push("-macalg", "sha256");
  } else {
    // PBE-SHA1-3DES — legacy algorithm, requires loading the legacy provider.
    args.push("-keypbe", "PBE-SHA1-3DES");
    args.push("-certpbe", "PBE-SHA1-3DES");
    args.push("-legacy");
  }
  return args;
}

export async function mergePkcs12(
  params: MergeRequest,
  workDirOverride?: string
): Promise<OperationResult> {
  const inputCheck = validateInputs(params);
  if (!inputCheck.ok) {
    log.warn("merge: invalid input", inputCheck.details);
    return { success: false, message: inputCheck.message };
  }

  const exportPw = validatePassword(params.exportPassword);
  if (!exportPw.ok) {
    log.warn("merge: invalid input", { field: "exportPassword", reason: exportPw.reason });
    return { success: false, message: "error.invalidInput", details: { field: "exportPassword", reason: exportPw.reason } };
  }

  const outCheck = validateOutputPath(params.outputFile);
  if (!outCheck.ok) {
    log.warn("merge: invalid input", { field: "outputFile", reason: outCheck.reason });
    return { success: false, message: "error.invalidInput", details: { field: "outputFile", reason: outCheck.reason } };
  }

  // Token validation — rejects when any input file changed since precheck.
  if (!validatePrecheckToken(params.precheckToken, tokenFiles(params))) {
    return { success: false, message: "error.staleToken" };
  }

  const workDir = workDirOverride ?? resolveWorkDir();
  const tmp = new TempFileManager({ workDir });
  tmp.ensureWorkDir();
  tmp.registerProcessExitHandlers();
  try {
    // Re-run precheck logic to discover warnings that must be confirmed.
    const pre = await mergePrecheck(params, workDir);
    if (!pre.success) {
      return { success: false, message: pre.message };
    }
    const requiredCodes = (pre.warnings ?? [])
      .filter((w) => w.requiresConfirmation)
      .map((w) => w.code);
    const confirmed = new Set<WarningCode>(params.confirmedWarningCodes ?? []);
    const missing = requiredCodes.filter((c) => !confirmed.has(c));
    if (missing.length > 0) {
      return {
        success: false,
        message: "error.unconfirmedWarnings",
        details: { missing },
        warnings: pre.warnings
      };
    }

    // Build combined chain.pem from the normalized chain (not including server cert).
    const normalized = pre.details!.normalizedChainCerts;
    let chainPemPath: string | undefined;
    if (normalized.length > 0) {
      // Re-parse chain inputs to get rawPem for each; then writeChainPem.
      const chainParsed = await parseCertificateFiles(params.chainCertFiles, workDir);
      const serverFp = (await parseCertificateFiles([params.serverCertFile], workDir))[0].info.fingerprint.sha256;
      const { unique } = deduplicateCerts(chainParsed);
      const uniqueWithoutServer = unique.filter((c) => c.info.fingerprint.sha256 !== serverFp);
      // Reorder to match normalizedChainCerts order
      const ordered: ParsedCert[] = [];
      for (const n of normalized) {
        const match = uniqueWithoutServer.find((c) => c.info.fingerprint.sha256 === n.cert.fingerprint.sha256);
        if (match) ordered.push(match);
      }
      if (ordered.length > 0) {
        chainPemPath = tmp.createTempFile("chain.pem");
        await writeChainPem(ordered, chainPemPath);
      }
    }

    const args = buildPkcs12Args({
      algorithm: params.algorithm,
      keyPath: params.privateKeyFile,
      certPath: params.serverCertFile,
      chainPemPath,
      outputPath: params.outputFile,
      hasKeyPassword: !!params.privateKeyPassword
    });

    const env: NodeJS.ProcessEnv = { EXPORT_PASSWORD: params.exportPassword };
    if (params.privateKeyPassword) env.KEY_PASSWORD = params.privateKeyPassword;

    const r = await runOpenssl(args, { env });
    if (r.exitCode !== 0) {
      return {
        success: false,
        message: "error.opensslFailed",
        details: { exitCode: r.exitCode, stderr: r.stderr }
      };
    }

    log.info("merge done", { algorithm: params.algorithm, output: params.outputFile });
    return {
      success: true,
      message: "common.mergeSucceeded",
      outputFiles: [params.outputFile]
    };
  } catch (err) {
    log.error("merge failed", undefined, err);
    return { success: false, message: "error.unknown" };
  } finally {
    tmp.cleanup();
  }
}

// Exposed for tests
export const _internals = { buildPkcs12Args };
