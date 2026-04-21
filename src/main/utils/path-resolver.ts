import { app } from "electron";
import { dirname, join, resolve } from "node:path";

// Two distinct roots in a portable build:
//   - engines live inside the self-extracted temp folder at process.resourcesPath/engines
//   - .work / logs must live beside the user-visible portable launcher (PORTABLE_EXECUTABLE_DIR)
// In dev both collapse to the project root.

function devProjectRoot(): string {
  // compiled main lives at <project>/dist/main/utils
  return resolve(__dirname, "..", "..", "..");
}

export function resolveRuntimeDir(): string {
  if (app.isPackaged) {
    return process.env.PORTABLE_EXECUTABLE_DIR || dirname(app.getPath("exe"));
  }
  return devProjectRoot();
}

// Back-compat alias: callers that need the user-visible dir (logs/.work).
export function resolveExeDir(): string {
  return resolveRuntimeDir();
}

export function resolveLogsDir(): string {
  return join(resolveRuntimeDir(), "logs");
}

export function resolveEnginesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "engines");
  }
  return join(devProjectRoot(), "engines");
}

export function resolveOpensslPath(): string {
  return join(resolveEnginesDir(), "openssl", "openssl.exe");
}

export function resolveOpensslModulesDir(): string {
  return join(resolveEnginesDir(), "openssl", "ossl-modules");
}

export function resolveKeytoolPath(): string {
  return join(resolveEnginesDir(), "jre-minimal", "bin", "keytool.exe");
}

export function resolveJavaPath(): string {
  return join(resolveEnginesDir(), "jre-minimal", "bin", "java.exe");
}

export function resolveWorkDir(): string {
  return join(resolveRuntimeDir(), ".work");
}
