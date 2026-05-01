import { runOpenssl } from "../engines/openssl-runner";
import { runKeytool } from "../engines/keytool-runner";
import {
  resolveOpensslPath,
  resolveKeytoolPath,
  resolveEnginesDir
} from "../utils/path-resolver";

export type EngineInfo = {
  openssl: { path: string; version: string };
  keytool: { path: string; version: string };
  enginesDir: string;
};

let cache: EngineInfo | null = null;

function firstLine(s: string): string {
  return s.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

export async function getEngineInfo(): Promise<EngineInfo> {
  if (cache) return cache;

  const opensslPath = resolveOpensslPath();
  const keytoolPath = resolveKeytoolPath();
  let opensslVersion = "";
  let keytoolVersion = "";

  try {
    const r = await runOpenssl(["version"]);
    opensslVersion = r.exitCode === 0 ? firstLine(r.stdout) : "(unavailable)";
  } catch {
    opensslVersion = "(unavailable)";
  }

  try {
    const r = await runKeytool(["-J-version"], { timeoutMs: 15_000 });
    // keytool -J-version prints "java version ..." to stderr (it's a JVM flag).
    const out = r.stderr || r.stdout;
    keytoolVersion = r.exitCode === 0 || out ? firstLine(out) : "(unavailable)";
    if (!keytoolVersion) keytoolVersion = "(unavailable)";
  } catch {
    keytoolVersion = "(unavailable)";
  }

  cache = {
    openssl: { path: opensslPath, version: opensslVersion },
    keytool: { path: keytoolPath, version: keytoolVersion },
    enginesDir: resolveEnginesDir()
  };
  return cache;
}

export function _resetEngineInfoCacheForTests(): void {
  cache = null;
}
