# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

五合一 PKCS #12 轉檔處理工具 — 一個 Windows 桌面應用程式，提供 GUI 介面讓不熟悉 CLI 操作的使用者完成 PKCS#12 相關的憑證檔案處理。程式為免安裝可攜式應用，自帶 OpenSSL 和最小 JRE/Keytool，不依賴使用者系統上的任何軟體。

**目前狀態：spec-first，尚無程式碼。** 規格文件為 `spec.md`（完整技術規格書）、`PFX轉檔程式企畫書.txt`（企劃書）、`pkcs12轉檔工具_規格書修改_20260409.txt`（規格修訂）。

## Five Core Functions

1. **合成 PKCS#12** — 私鑰 + 憑證 + 中繼憑證 → `.pfx/.p12`（支援 AES-256-CBC / PBE-SHA1-3DES）
2. **抽取** — 從 `.pfx/.p12` 分離出私鑰（`.key`，無加密）與憑證（合併 `.pem` 或拆分 `.crt`）
3. **檢視** — 結構化顯示 PKCS#12 內容（私鑰資訊、憑證鏈、SKI、SAN、fingerprint）
4. **JKS → P12** — 透過 Keytool 轉換，支援多 alias 選擇
5. **P12 → JKS** — 透過 Keytool 轉換，輸出 alias 固定為 `1`

操作串接：合成成功後可直接轉 JKS；JKS→P12 成功後可直接抽取。

## Build & Development Commands

```bash
npm install          # install Electron, Vue 3, Vite, vue-i18n, packaging deps
npm run dev          # start desktop app in dev mode
npm run build        # build renderer and Electron bundle
npm run package      # create portable Windows output with electron-builder
npm test             # run automated tests
```

## Architecture

**Tech stack:** Electron + Vue 3 + Vite + TypeScript + vue-i18n + electron-builder

```
Renderer (Vue 3)  ──IPC invoke/handle──▶  Main Process (Node.js)
  - No direct Node.js/fs access              - OpenSSL/Keytool subprocess execution
  - contextBridge only                       - All file I/O and input validation
```

### Main Process Module Layout

```
main/
├── ipc-handlers.ts          # IPC channel registration and routing
├── engines/
│   ├── openssl-runner.ts    # OpenSSL CLI wrapper (execFile, not exec)
│   ├── keytool-runner.ts    # Keytool CLI wrapper
│   └── output-parser.ts     # Parse OpenSSL/Keytool stdout/stderr
├── services/
│   ├── merge-service.ts     # PKCS#12 merge with precheck/token flow
│   ├── extract-service.ts   # Extract with legacy auto-detection
│   ├── view-service.ts      # Structured certificate info parsing
│   └── convert-service.ts   # JKS ↔ P12 conversion
├── utils/
│   ├── path-resolver.ts     # Resolve bundled engine paths relative to app dir
│   ├── sanitizer.ts         # Input validation (no shell escaping — execFile handles this)
│   └── temp-file.ts         # Temp file management (.work/ only, guaranteed cleanup)
└── preload.ts               # contextBridge API exposure
```

### IPC Channel Naming

Channels use namespaced format: `pkcs12:merge`, `pkcs12:merge:precheck`, `pkcs12:extract`, `pkcs12:view`, `jks:toP12`, `jks:fromP12`, `jks:listAliases`, `dialog:openFile`, `dialog:saveFile`.

### Key Domain Types

- `OperationRequest` — per-user-action request with type, files, passwords, options
- `OperationResult` — success/failure with output files, warnings, confirmation flags
- `MergePrecheckResult` — precheck token, normalized chain, dropped certs, anchor detection
- `WarningCode` — `CHAIN_REORDERED | CHAIN_HAS_EXTRA_CERTS | CHAIN_HAS_DUPLICATE_CERTS | CHAIN_HAS_ANCHOR | CHAIN_NOT_LINKED | LEGACY_MODE_UNCERTAIN`

## Critical Design Constraints

- **Portable:** No writes to Registry, AppData, or outside program folder (except user-specified output). Temp files go to `.work/` beside the exe only — never system temp, never inside `resources/app/`.
- **Offline:** Zero network requests. No telemetry, no update checks, no external resources.
- **Passwords never touch disk:** All passwords stay in memory. Pass via `execFile` args or stdin, never temp files.
- **execFile only:** All OpenSSL/Keytool invocations must use `execFile` with argument arrays. Never `exec` or shell string concatenation. Input validation only checks legality — no shell escaping that would alter values.
- **Temp cleanup guaranteed:** `.work/` contents must be deleted on operation success, failure, or process exit.
- **Subprocess timeout:** 30-second timeout on all OpenSSL/Keytool invocations.
- **Context isolation enforced:** Renderer cannot access `fs`, `child_process`, or any Node.js API directly.

## Merge Precheck Flow

Merge operations require a two-step flow: `pkcs12:merge:precheck` returns a `precheckToken` plus organized chain/warnings, then `pkcs12:merge` validates the token and confirmed warning codes before executing. If input files change between precheck and merge, token becomes invalid and precheck must re-run.

Chain processing: parse all inputs → DER-to-PEM conversion → deduplicate → filter unrelated certs → reorder by issuer/subject linkage → output single temp `chain.pem`. Warn on anchor (self-signed root), unlinked chain, extra/duplicate certs — but always allow user to force-continue.

## Coding Conventions

- TypeScript throughout, 2-space indentation
- Kebab-case filenames: `merge-service.ts`, `keytool-runner.ts`
- One module per responsibility
- Test files named after subject: `merge-service.test.ts`, `output-parser.test.ts`
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`

## Bundled Engines (Post-packaging)

```
engines/
├── openssl/
│   ├── openssl.exe
│   ├── libssl-3-x64.dll
│   └── libcrypto-3-x64.dll
└── jre-minimal/
    ├── bin/java.exe, keytool.exe
    └── lib/  (jlink-trimmed, java.base + java.security only)
```

OpenSSL 3.x series. JRE from Adoptium (Eclipse Temurin), trimmed with `jlink`.

## Windows Shell Notes

Default to UTF-8 when reading files from PowerShell to avoid mojibake with Chinese filenames. Prepend `chcp 65001` before PowerShell commands when needed.

## Milestones

- **M1:** Core PKCS#12 operations (merge + extract + view) + Electron/Vue scaffold
- **M2:** JKS ↔ P12 conversion with Keytool/JRE integration
- **M3:** UI polish, i18n completion, electron-builder portable packaging, final testing on clean Windows 10/11
