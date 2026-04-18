import { app } from "electron";
import { dirname, join, resolve } from "node:path";

// In dev the compiled main lives at <project>/dist/main/utils, so exe dir is project root.
// In prod (electron-builder portable), app.getPath('exe') points to the portable exe beside engines/.
export function resolveExeDir(): string {
  if (app.isPackaged) {
    return dirname(app.getPath("exe"));
  }
  // dev: project root is two levels up from this file (dist/main/utils -> project)
  return resolve(__dirname, "..", "..", "..");
}

export function resolveLogsDir(): string {
  return join(resolveExeDir(), "logs");
}

export function resolveEnginesDir(): string {
  return join(resolveExeDir(), "engines");
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
  return join(resolveExeDir(), ".work");
}
