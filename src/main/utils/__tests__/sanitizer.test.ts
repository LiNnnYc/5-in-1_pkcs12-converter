import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateFilePath,
  validateOutputPath,
  validateOutputDir,
  validatePassword,
  validateFileExtension
} from "../sanitizer";

let tmpRoot: string;
let existingFile: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pkcs12-san-"));
  existingFile = join(tmpRoot, "sample.pem");
  writeFileSync(existingFile, "test");
});

afterAll(() => {
  try {
    chmodSync(tmpRoot, 0o700);
  } catch {
    // ignore
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("validateFilePath", () => {
  it("accepts an existing readable file", () => {
    expect(validateFilePath(existingFile).ok).toBe(true);
  });
  it("rejects empty string", () => {
    expect(validateFilePath("").ok).toBe(false);
  });
  it("rejects relative path", () => {
    expect(validateFilePath("relative/file.txt").ok).toBe(false);
  });
  it("rejects control chars", () => {
    expect(validateFilePath("C:\\bad\u0001file").ok).toBe(false);
  });
  it("rejects non-existent file", () => {
    expect(validateFilePath(join(tmpRoot, "missing.pem")).ok).toBe(false);
  });
  it("rejects directory", () => {
    expect(validateFilePath(tmpRoot).ok).toBe(false);
  });
});

describe("validateOutputPath", () => {
  it("accepts writable parent directory", () => {
    expect(validateOutputPath(join(tmpRoot, "new.pfx")).ok).toBe(true);
  });
  it("rejects missing parent", () => {
    expect(validateOutputPath(join(tmpRoot, "missing-dir", "out.pfx")).ok).toBe(false);
  });
  it("rejects relative path", () => {
    expect(validateOutputPath("out.pfx").ok).toBe(false);
  });
});

describe("validateOutputDir", () => {
  it("accepts existing writable directory", () => {
    expect(validateOutputDir(tmpRoot).ok).toBe(true);
  });
  it("rejects file", () => {
    expect(validateOutputDir(existingFile).ok).toBe(false);
  });
});

describe("validatePassword", () => {
  it("accepts non-empty", () => {
    expect(validatePassword("hunter2").ok).toBe(true);
  });
  it("rejects empty", () => {
    expect(validatePassword("").ok).toBe(false);
  });
  it("rejects non-string", () => {
    expect(validatePassword(123).ok).toBe(false);
  });
  it("rejects NUL byte", () => {
    expect(validatePassword("bad\u0000pw").ok).toBe(false);
  });
});

describe("validateFileExtension", () => {
  it("accepts matching extension case-insensitive", () => {
    expect(validateFileExtension("a.PFX", ["pfx", "p12"]).ok).toBe(true);
  });
  it("rejects unmatched extension", () => {
    expect(validateFileExtension("a.txt", ["pfx"]).ok).toBe(false);
  });
  it("accepts .pem when allowed with leading dot", () => {
    expect(validateFileExtension("a.pem", [".pem"]).ok).toBe(true);
  });
});
