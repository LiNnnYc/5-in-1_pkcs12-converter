import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initLogger,
  createLogger,
  getSessionId,
  getLogFilePath,
  isLoggerEnabled,
  shutdownLogger,
  _resetForTests
} from "../logger";
import { redact } from "../log-redact";
import { rotateLogs } from "../log-rotate";

function makeExeDir(): string {
  return mkdtempSync(join(tmpdir(), "pkcs12-logger-"));
}

describe("logger", () => {
  let exeDir: string;

  beforeEach(() => {
    exeDir = makeExeDir();
    _resetForTests();
    delete process.env.PKCS12_DEBUG;
  });

  afterEach(() => {
    shutdownLogger();
    try { rmSync(exeDir, { recursive: true, force: true }); } catch { /* noop */ }
    _resetForTests();
  });

  it("sessionId format matches /^#[0-9a-f]{8}$/ even when disabled", () => {
    initLogger({ exeDir, argv: [] });
    expect(getSessionId()).toMatch(/^#[0-9a-f]{8}$/);
    expect(isLoggerEnabled()).toBe(false);
  });

  it("disabled state is a no-op — no logs dir, no file written", () => {
    initLogger({ exeDir, argv: [] });
    const log = createLogger("test");
    log.info("hello", { foo: 1 });
    expect(existsSync(join(exeDir, "logs"))).toBe(false);
    expect(getLogFilePath()).toBeNull();
  });

  it("writes JSON-L lines when enabled via forceEnable", () => {
    initLogger({ exeDir, argv: [], forceEnable: true });
    expect(isLoggerEnabled()).toBe(true);
    const log = createLogger("test");
    log.info("hello", { foo: 1 });
    log.error("boom", { x: 2 }, new Error("fail"));
    shutdownLogger();

    const path = getLogFilePath()!;
    expect(path).toBeTruthy();
    const content = readFileSync(path, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const ln of lines) {
      const parsed = JSON.parse(ln);
      expect(parsed.sessionId).toMatch(/^#[0-9a-f]{8}$/);
      expect(parsed.ts).toBeTypeOf("string");
      expect(parsed.scope).toBe("test");
      expect(["info", "error", "warn", "debug"]).toContain(parsed.level);
    }
  });

  it("enables via PKCS12_DEBUG=1", () => {
    process.env.PKCS12_DEBUG = "1";
    initLogger({ exeDir, argv: [] });
    expect(isLoggerEnabled()).toBe(true);
  });

  it("enables via --debug argv", () => {
    initLogger({ exeDir, argv: ["node", "app", "--debug"] });
    expect(isLoggerEnabled()).toBe(true);
  });

  it("enables via .enabled marker file", () => {
    const logsDir = join(exeDir, "logs");
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, ".enabled"), "");
    initLogger({ exeDir, argv: [] });
    expect(isLoggerEnabled()).toBe(true);
  });
});

describe("log-redact", () => {
  it("redacts forbidden top-level keys (case-insensitive)", () => {
    const input = { password: "s3cret", Password: "x", pfxPw: "y", keyPW: "z", normal: "ok" };
    const out = redact(input) as Record<string, unknown>;
    expect(out.password).toBe("***");
    expect(out.Password).toBe("***");
    expect(out.pfxPw).toBe("***");
    expect(out.keyPW).toBe("***");
    expect(out.normal).toBe("ok");
  });

  it("redacts nested passwords", () => {
    const input = { outer: { inner: { passphrase: "s", safe: 1 } } };
    const out = redact(input) as any;
    expect(out.outer.inner.passphrase).toBe("***");
    expect(out.outer.inner.safe).toBe(1);
  });

  it("redacts forbidden env keys when object looks like process.env", () => {
    const input = { env: { EXPORT_PASSWORD: "secret", PATH: "/usr/bin" } };
    const out = redact(input) as any;
    expect(out.env.EXPORT_PASSWORD).toBe("***");
    expect(out.env.PATH).toBe("/usr/bin");
  });

  it("handles circular references safely", () => {
    const a: any = { name: "a" };
    a.self = a;
    const out = redact(a) as any;
    expect(out.name).toBe("a");
    expect(out.self).toBe("[Circular]");
  });

  it("preserves arrays and primitives", () => {
    expect(redact([1, "s", { password: "x" }])).toEqual([1, "s", { password: "***" }]);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
  });
});

describe("log-rotate", () => {
  it("removes oldest files when count exceeds maxFiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkcs12-rotate-"));
    try {
      for (let i = 0; i < 20; i++) {
        const sid = i.toString(16).padStart(8, "0");
        const p = join(dir, `app-2026-04-${String(i + 1).padStart(2, "0")}_#${sid}.log`);
        writeFileSync(p, "x");
        // stagger mtime so ordering is deterministic
        const fs = require("node:fs") as typeof import("node:fs");
        fs.utimesSync(p, new Date(i * 1000 + 1_000_000_000), new Date(i * 1000 + 1_000_000_000));
      }
      rotateLogs({ logsDir: dir, maxFiles: 14, maxTotalBytes: Infinity });
      const left = readdirSync(dir).filter((n) => n.endsWith(".log"));
      expect(left.length).toBe(14);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes oldest until total bytes under cap", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkcs12-rotate-"));
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      const big = "x".repeat(1024 * 1024); // 1 MB
      for (let i = 0; i < 5; i++) {
        const sid = i.toString(16).padStart(8, "0");
        const p = join(dir, `app-2026-04-0${i + 1}_#${sid}.log`);
        writeFileSync(p, big);
        fs.utimesSync(p, new Date(i * 1000 + 1_000_000_000), new Date(i * 1000 + 1_000_000_000));
      }
      rotateLogs({ logsDir: dir, maxFiles: 14, maxTotalBytes: 2 * 1024 * 1024 });
      const left = readdirSync(dir).filter((n) => n.endsWith(".log"));
      expect(left.length).toBeLessThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
