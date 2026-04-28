import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { containsNonAscii, withSafeOutputPath, readFileForOpenssl } from "../safe-path";

describe("containsNonAscii", () => {
  it("returns false for pure ASCII path", () => {
    expect(containsNonAscii("C:\\foo\\bar.pfx")).toBe(false);
    expect(containsNonAscii("/tmp/test.key")).toBe(false);
    expect(containsNonAscii("D:\\with space\\file.pem")).toBe(false);
  });

  it("returns true for CJK path", () => {
    expect(containsNonAscii("D:\\測試\\file.pfx")).toBe(true);
    expect(containsNonAscii("D:\\中華電信argus憑證\\argus2025.key")).toBe(true);
  });

  it("returns true for emoji or non-BMP path", () => {
    expect(containsNonAscii("D:\\🔐\\file.pfx")).toBe(true);
    expect(containsNonAscii("/tmp/テスト.key")).toBe(true);
  });
});

describe("withSafeOutputPath", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = join(tmpdir(), `safe-path-${randomBytes(4).toString("hex")}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("passes ASCII path through directly without using workDir", async () => {
    const target = join(workDir, "ascii-out.pem");
    const seen: string[] = [];
    await withSafeOutputPath(target, workDir, async (p) => {
      seen.push(p);
      writeFileSync(p, "hello");
    });
    expect(seen).toEqual([target]);
    expect(readFileSync(target, "utf8")).toBe("hello");
  });

  it("routes non-ASCII path through ASCII tmp and renames to user target", async () => {
    const cjkDir = join(workDir, "中文輸出");
    mkdirSync(cjkDir, { recursive: true });
    const target = join(cjkDir, "結果.pem");

    let givenPath = "";
    await withSafeOutputPath(target, workDir, async (p) => {
      givenPath = p;
      // The path handed to fn must not be the user's CJK path.
      expect(p).not.toBe(target);
      // It must live inside workDir with an ASCII name.
      expect(p.startsWith(workDir)).toBe(true);
      writeFileSync(p, "payload");
    });

    expect(givenPath.length).toBeGreaterThan(0);
    // After fn, target file exists with payload content.
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("payload");
    // Tmp must be cleaned up.
    expect(existsSync(givenPath)).toBe(false);
  });

  it("preserves file extension on the ASCII tmp name", async () => {
    const target = join(workDir, "輸出.pfx");
    let givenPath = "";
    await withSafeOutputPath(target, workDir, async (p) => {
      givenPath = p;
      writeFileSync(p, Buffer.from([1, 2, 3]));
    });
    expect(givenPath.endsWith(".pfx")).toBe(true);
  });

  it("removes the ASCII tmp if fn throws", async () => {
    const target = join(workDir, "失敗.pem");
    let givenPath = "";
    await expect(
      withSafeOutputPath(target, workDir, async (p) => {
        givenPath = p;
        writeFileSync(p, "partial");
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(existsSync(givenPath)).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it("does not fail if fn produces no file (caller will detect)", async () => {
    const target = join(workDir, "空.pem");
    await expect(
      withSafeOutputPath(target, workDir, async () => {
        // intentionally writes nothing
      })
    ).resolves.toBeUndefined();
    expect(existsSync(target)).toBe(false);
  });
});

describe("readFileForOpenssl", () => {
  it("reads file content as Buffer regardless of path encoding", async () => {
    const dir = join(tmpdir(), `read-${randomBytes(4).toString("hex")}-中`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "資料.bin");
    const payload = Buffer.from("ABC測試\n", "utf8");
    writeFileSync(path, payload);
    try {
      const got = await readFileForOpenssl(path);
      expect(got.equals(payload)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
