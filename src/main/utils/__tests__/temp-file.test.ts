import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TempFileManager } from "../temp-file";

let tmpRoot: string;
let workDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "pkcs12-tmp-"));
  workDir = join(tmpRoot, ".work");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("TempFileManager", () => {
  it("creates the work dir and writes a tracked file", () => {
    const mgr = new TempFileManager({ workDir });
    const file = mgr.createTempFile("chain.pem", "hello");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("hello");
    expect(file.startsWith(workDir)).toBe(true);
  });

  it("sanitizes unsafe characters in name", () => {
    const mgr = new TempFileManager({ workDir });
    const file = mgr.createTempFile("../evil name$.pem", "x");
    const base = file.slice(workDir.length + 1);
    expect(base.includes("$")).toBe(false);
    expect(base.includes("/")).toBe(false);
    expect(base.includes("\\")).toBe(false);
    expect(base.includes(" ")).toBe(false);
  });

  it("cleanup removes all tracked files and the work dir", () => {
    const mgr = new TempFileManager({ workDir });
    const a = mgr.createTempFile("a.pem", "a");
    const b = mgr.createTempFile("b.pem", "b");
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
    mgr.cleanup();
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
    expect(existsSync(workDir)).toBe(false);
  });

  it("cleanup is idempotent when nothing to clean", () => {
    const mgr = new TempFileManager({ workDir });
    expect(() => mgr.cleanup()).not.toThrow();
  });

  it("trackFile adopts an external file and removes it on cleanup", () => {
    const mgr = new TempFileManager({ workDir });
    mgr.ensureWorkDir();
    const external = mgr.createTempFile("ext.pem", "data");
    mgr.trackFile(external);
    mgr.cleanup();
    expect(existsSync(external)).toBe(false);
  });
});
