import { open } from "node:fs/promises";
import type { DetectInputTypeResult, InputKind } from "../../types";
import { runOpenssl } from "../engines/openssl-runner";
import { readFileForOpenssl } from "../utils/safe-path";
import { validateFilePath } from "../utils/sanitizer";
import { createLogger } from "../utils/logger";

const log = createLogger("detect");

const PROBE_TIMEOUT_MS = 5_000;
const HEAD_READ_BYTES = 64 * 1024;

const PEM_ENCRYPTED_PKCS8 = /-----BEGIN ENCRYPTED PRIVATE KEY-----/;
const PEM_PKCS8 = /-----BEGIN PRIVATE KEY-----/;
const PEM_TRADITIONAL_KEY = /-----BEGIN (RSA|EC|DSA|DH) PRIVATE KEY-----/;
const PEM_PROC_TYPE_ENCRYPTED = /Proc-Type:\s*4,\s*ENCRYPTED/i;

// Probe-style detection — no shell, no temp files, OpenSSL gets the user
// path directly (or via stdin where the existing helpers already do).
// Each OpenSSL call has its own 5s budget; total worst-case is bounded by
// the at-most-3 probes we issue here (~15s).
export async function detectInputType(
  filePath: string
): Promise<DetectInputTypeResult> {
  const v = validateFilePath(filePath);
  if (!v.ok) {
    return { kind: "unknown", reason: v.reason };
  }

  let head: Buffer;
  try {
    head = await readHead(filePath, HEAD_READ_BYTES);
  } catch (e) {
    log.warn("readHead failed", { filePath, err: (e as Error)?.message });
    return { kind: "unknown", reason: "cannot read file head" };
  }

  const headText = head.toString("utf8");

  if (PEM_ENCRYPTED_PKCS8.test(headText)) {
    return { kind: "keyEncrypted" };
  }

  if (PEM_TRADITIONAL_KEY.test(headText)) {
    return PEM_PROC_TYPE_ENCRYPTED.test(headText)
      ? { kind: "keyEncrypted" }
      : { kind: "keyUnencrypted" };
  }

  if (PEM_PKCS8.test(headText)) {
    // PKCS#8 header is ambiguous — could be unencrypted, or encrypted but
    // mislabelled (rare but legal). Probe with an empty passphrase: a true
    // unencrypted key parses; an encrypted one bails with a passphrase-shaped
    // error.
    const probe = await probePkey(filePath, /* inform */ undefined);
    if (probe.exitCode === 0) return { kind: "keyUnencrypted" };
    if (looksLikePassphraseError(probe.stderr)) {
      return { kind: "keyEncrypted" };
    }
    return { kind: "unknown", reason: "pkcs8 probe failed" };
  }

  // Not PEM. Could be DER PFX or DER key. First byte of either is 0x30
  // (ASN.1 SEQUENCE) so the only reliable disambiguation is to ask OpenSSL.
  if (head.length === 0) {
    return { kind: "unknown", reason: "empty file" };
  }
  if (head[0] !== 0x30) {
    return { kind: "unknown", reason: "unrecognized header" };
  }

  const pfxProbe = await probePfx(filePath);
  if (looksLikePfx(pfxProbe.exitCode, pfxProbe.stderr)) {
    return { kind: "pfx" };
  }

  const derKeyProbe = await probePkey(filePath, "DER");
  if (derKeyProbe.exitCode === 0) {
    return { kind: "keyUnencrypted" };
  }

  return { kind: "unknown", reason: "no probe succeeded" };
}

async function readHead(filePath: string, max: number): Promise<Buffer> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function probePkey(filePath: string, inform: "DER" | undefined) {
  // PEM path uses stdin (text-safe, dodges non-ASCII path bug). DER path
  // must use `-in <path>` because piping binary via stdin trips Windows
  // CRLF translation and OpenSSL fails to parse — see convertDerToPem for
  // the same workaround. The plan forbids writing temp files during detection,
  // so for DER we accept the documented limitation that non-ASCII paths may
  // fail the probe and fall through to `unknown`.
  if (inform === "DER") {
    return runOpenssl(
      ["pkey", "-inform", "DER", "-noout", "-in", filePath],
      { timeoutMs: PROBE_TIMEOUT_MS }
    );
  }
  const buf = await readFileForOpenssl(filePath);
  return runOpenssl(["pkey", "-noout"], { stdin: buf, timeoutMs: PROBE_TIMEOUT_MS });
}

async function probePfx(filePath: string) {
  // PFX is DER — same Windows stdin/CRLF concern as the DER pkey probe.
  // Empty password — fails on a real password-protected PFX but the failure
  // mode is distinctive (mac verify failure / bad decrypt), which is exactly
  // what we use to confirm "yes, this is a PFX".
  return runOpenssl(
    ["pkcs12", "-info", "-noout", "-passin", "pass:", "-in", filePath],
    { timeoutMs: PROBE_TIMEOUT_MS }
  );
}

function looksLikePfx(exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return true;
  return /mac verify failure|bad decrypt|invalid password/i.test(stderr);
}

function looksLikePassphraseError(stderr: string): boolean {
  return /bad decrypt|passphrase|Could not read private key|unable to load|wrong password/i.test(stderr);
}

// Re-export for tests that want to assert the InputKind union value.
export type { InputKind };
