import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CertificateInfo, OperationWarning, WarningCode } from "../../types";
import {
  detectFormat,
  convertDerToPem,
  parseCertificateText,
  readPem
} from "../engines/openssl-runner";
import { parseCertInfo, splitPemCerts } from "../engines/output-parser";

export type ParsedCert = {
  info: CertificateInfo;
  rawPem: string;
  sourceFile: string;
};

export type BuildChainResult = {
  chain: ParsedCert[];
  unrelated: ParsedCert[];
  anchor?: ParsedCert;
  linked: boolean;
};

// Read and parse every file. A single file may contain multiple PEM blocks
// (common for chain bundles), each one becomes its own ParsedCert.
export async function parseCertificateFiles(
  files: string[],
  workDir: string
): Promise<ParsedCert[]> {
  const out: ParsedCert[] = [];
  for (const file of files) {
    const fmt = await detectFormat(file);
    let pemText: string;
    if (fmt === "DER") {
      const pemPath = `${workDir}/der-${Date.now()}-${out.length}.pem`;
      await mkdir(dirname(pemPath), { recursive: true });
      const r = await convertDerToPem(file, pemPath);
      if (r.exitCode !== 0) {
        throw new Error(`DER conversion failed for ${file}: ${r.stderr}`);
      }
      pemText = await readPem(pemPath);
    } else {
      pemText = await readPem(file);
    }
    const blocks = splitPemCerts(pemText);
    if (blocks.length === 0) {
      throw new Error(`No certificate found in ${file}`);
    }
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const tmpPath = `${workDir}/single-${Date.now()}-${out.length}.pem`;
      await mkdir(dirname(tmpPath), { recursive: true });
      await writeFile(tmpPath, block);
      const textRes = await parseCertificateText(tmpPath);
      if (textRes.exitCode !== 0) {
        throw new Error(`parseCertificateText failed for ${file}#${i}: ${textRes.stderr}`);
      }
      out.push({
        info: parseCertInfo(textRes.stdout),
        rawPem: block.endsWith("\n") ? block : `${block}\n`,
        sourceFile: file
      });
    }
  }
  return out;
}

export function deduplicateCerts(certs: ParsedCert[]): {
  unique: ParsedCert[];
  duplicates: ParsedCert[];
} {
  const seen = new Map<string, ParsedCert>();
  const duplicates: ParsedCert[] = [];
  for (const c of certs) {
    const key = c.info.fingerprint.sha256 || `${c.info.subject}|${c.info.serialNumber}`;
    if (seen.has(key)) {
      duplicates.push(c);
    } else {
      seen.set(key, c);
    }
  }
  return { unique: Array.from(seen.values()), duplicates };
}

// Normalize DN for loose comparison (whitespace-insensitive).
function normDn(dn: string): string {
  return dn.replace(/\s+/g, "").toLowerCase();
}

function isSelfSigned(c: ParsedCert): boolean {
  return normDn(c.info.subject) === normDn(c.info.issuer);
}

// Find the parent of `child` within `pool`, using AKI↔SKI when both sides have
// the identifier, and falling back to issuer↔subject DN comparison.
function findParent(child: ParsedCert, pool: ParsedCert[]): ParsedCert | undefined {
  // Primary: AKI of child must match SKI of parent
  if (child.info.authorityKeyIdentifier) {
    const aki = child.info.authorityKeyIdentifier;
    const byKid = pool.find(
      (p) => p !== child && p.info.subjectKeyIdentifier && p.info.subjectKeyIdentifier === aki
    );
    if (byKid) return byKid;
  }
  // Fallback: issuer DN of child matches subject DN of parent
  const issuer = normDn(child.info.issuer);
  const byDn = pool.find((p) => p !== child && normDn(p.info.subject) === issuer);
  return byDn;
}

export function buildChain(
  serverCert: ParsedCert,
  candidates: ParsedCert[]
): BuildChainResult {
  const chain: ParsedCert[] = [serverCert];
  const visited = new Set<string>();
  visited.add(serverCert.info.fingerprint.sha256);

  // Pool excludes the server cert itself; we look for parents inside it.
  const pool = candidates.filter((c) => c !== serverCert);

  let current = serverCert;
  let anchor: ParsedCert | undefined;
  if (isSelfSigned(serverCert)) {
    anchor = serverCert;
  }

  while (true) {
    if (isSelfSigned(current) && current !== serverCert) {
      anchor = current;
      break;
    }
    const parent = findParent(current, pool);
    if (!parent) break;
    const fp = parent.info.fingerprint.sha256 || `${parent.info.subject}|${parent.info.serialNumber}`;
    if (visited.has(fp)) break; // loop guard
    visited.add(fp);
    chain.push(parent);
    if (isSelfSigned(parent)) {
      anchor = parent;
      break;
    }
    current = parent;
  }

  const usedSet = new Set(chain);
  const unrelated = pool.filter((c) => !usedSet.has(c));

  // Linked iff (a) chain terminates at self-signed anchor, or (b) chain's top
  // cert has no AKI (i.e. caller supplied a partial chain on purpose and the
  // top is a trust anchor or intermediate whose parent lives in the system
  // trust store). For M1 we treat "top cert has no parent in the pool AND is
  // not self-signed AND has an AKI" as NOT_LINKED.
  const top = chain[chain.length - 1];
  const linked = isSelfSigned(top) || !top.info.authorityKeyIdentifier;

  return { chain, unrelated, anchor, linked };
}

export function generateChainWarnings(
  buildResult: BuildChainResult,
  originalOrder: ParsedCert[],
  duplicates: ParsedCert[]
): OperationWarning[] {
  const warnings: OperationWarning[] = [];
  const push = (code: WarningCode, message: string, details?: Record<string, unknown>) => {
    warnings.push({ code, message, requiresConfirmation: true, details });
  };

  if (duplicates.length > 0) {
    push("CHAIN_HAS_DUPLICATE_CERTS", `Found ${duplicates.length} duplicate certificate(s)`, {
      count: duplicates.length,
      subjects: duplicates.map((d) => d.info.subject)
    });
  }

  if (buildResult.unrelated.length > 0) {
    push("CHAIN_HAS_EXTRA_CERTS", `Filtered ${buildResult.unrelated.length} unrelated certificate(s)`, {
      count: buildResult.unrelated.length,
      subjects: buildResult.unrelated.map((u) => u.info.subject)
    });
  }

  if (buildResult.anchor) {
    push("CHAIN_HAS_ANCHOR", "Chain contains a self-signed root (anchor)", {
      subject: buildResult.anchor.info.subject
    });
  }

  if (!buildResult.linked) {
    push("CHAIN_NOT_LINKED", "Chain could not be fully linked to a trust anchor");
  }

  // Reorder detection: compare order of `chain[1..]` (intermediates/anchor) to
  // `originalOrder` (what the user provided, server cert excluded).
  const serverCert = buildResult.chain[0];
  const originalWithoutServer = originalOrder.filter((c) => c !== serverCert);
  const rebuiltWithoutServer = buildResult.chain.slice(1);
  const reordered =
    rebuiltWithoutServer.length > 0 &&
    !sameOrder(originalWithoutServer, rebuiltWithoutServer);
  if (reordered) {
    push("CHAIN_REORDERED", "Chain order was normalized to issuer → root");
  }

  return warnings;
}

function sameOrder(a: ParsedCert[], b: ParsedCert[]): boolean {
  if (a.length < b.length) return false;
  // Find each b item in a, in order, skipping extras in a.
  let i = 0;
  for (const item of b) {
    const found = a.indexOf(item, i);
    if (found === -1) return false;
    i = found + 1;
  }
  return true;
}

export async function writeChainPem(chain: ParsedCert[], outPath: string): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  const body = chain.map((c) => c.rawPem).join("");
  await writeFile(outPath, body, { encoding: "utf8" });
  return outPath;
}
