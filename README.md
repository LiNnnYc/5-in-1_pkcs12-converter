# 5-in-1 PKCS #12 Converter

A Windows desktop app for everyday PKCS #12 (`.pfx` / `.p12`) workflows — built for people who don't want to fight OpenSSL on the command line.

**Portable. Offline. No install. No telemetry.**

[繁體中文](#繁體中文) · [English](#english)

---

## English

### What it does

Five common PKCS #12 / JKS operations in one GUI:

1. **Generate** — combine a private key + certificate + intermediate chain into a `.pfx` (AES-256-CBC or PBE-SHA1-3DES)
2. **Extract** — split a `.pfx` back into key + certificates (combined `.pem` or per-cert `.crt`)
3. **View** — inspect a `.pfx` (private key info, full chain, SAN, SKI, fingerprints, PKCS #12 structure) or a standalone unencrypted private key (`.key` / `.pem`) for SKI comparison against Windows certificate viewer
4. **JKS → P12** — convert a Java KeyStore into PKCS #12 (with alias picker for multi-entry stores)
5. **P12 → JKS** — convert a PKCS #12 into a Java KeyStore (legacy PFX is auto-repackaged)

### Highlights

- **Portable** — single folder, no installer, no registry writes, runs from a USB stick
- **Offline** — zero network requests, no telemetry, no update checks
- **Bundled engines** — ships with OpenSSL 3.5.0 + a minimal JRE 21 (jlink-trimmed); no system OpenSSL/Java required
- **Passwords never touch disk** — passed to OpenSSL via environment variables only
- **Multilingual** — Traditional Chinese / English / 日本語
- **Cert Chain pre-check** — automatic chain reordering, duplicate detection, anchor warnings before generating

### Download

Grab the latest portable build from the [Releases](https://github.com/LiNnnYc/5-in-1_pkcs12-converter/releases) page:

- **`PKCS12_Converter-x.y.z.zip`** — extract anywhere and run `PKCS12_Converter.exe`

Windows 10 / 11 x64. No admin rights required.

> **Note on SmartScreen warnings:** the binary is currently unsigned. Windows may show a "Windows protected your PC" dialog on first run — click *More info* → *Run anyway*. Code signing is on the roadmap.

### Verifying release authenticity

Each release zip is signed via [Sigstore](https://www.sigstore.dev/) keyless signing through GitHub Actions. The attestation proves the artifact came from this repository's release workflow and has not been tampered with since publication.

Verify with the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify PKCS12_Converter-1.0.1.zip --owner LiNnnYc
```

A successful verification prints the workflow path, commit SHA, and Sigstore transparency log entry. Verification does not require the repo to be cloned.

### Build from source

```bash
git clone https://github.com/LiNnnYc/5-in-1_pkcs12-converter.git
cd 5-in-1_pkcs12-converter
npm install
# Place OpenSSL + JRE binaries under engines/ — see engines/README.md
npm run dev          # development mode
npm test             # run test suite
npm run package      # build portable .exe + .zip into release/
```

See [`engines/README.md`](engines/README.md) for instructions on obtaining and placing the third-party engine binaries.

### Tech stack

Electron 33 · Vue 3.5 · Vite 6 · TypeScript 5.7 · vue-i18n 10 · electron-builder 25 · vitest 2

### License

[MIT](LICENSE) © LiNnnYc

---

## 繁體中文

### 功能簡介

五項常用 PKCS #12 / JKS 操作整合成 GUI 界面：

1. **生成** — 私鑰 + 憑證 + 中繼憑證合成為 `.pfx`（AES-256-CBC 或 PBE-SHA1-3DES）
2. **抽取** — 從 `.pfx` 拆出私鑰與憑證（合併 `.pem` 或拆分 `.crt`）
3. **檢視** — 檢視 `.pfx`（私鑰資訊、完整憑證鏈、SAN、SKI、fingerprint、PKCS #12 結構），或獨立的未加密私鑰檔案（`.key` / `.pem`）以對照憑證的 SKI 欄位資訊
4. **JKS → P12** — Java KeyStore 轉檔成 PKCS #12（多個 entry 時可挑選 alias）
5. **P12 → JKS** — PKCS #12 轉檔成 Java KeyStore

### 特色

- **免安裝帶著走** — 單一資料夾、不會建立 Registry 註冊檔、可在隨身碟執行
- **完全離線** — 零網路請求、零遠端遙測、零更新檢查
- **內建引擎** — 內含 OpenSSL 3.5.0 + 最小需求的 JRE 21（透過 jlink 抽取），不需要在系統上安裝 OpenSSL / Java
- **密碼不外洩** — 僅透過環境變數傳遞給 OpenSSL，不寫入硬碟（轉檔過程中仍會短暫存於記憶體）
- **多語系** — 繁體中文 / English / 日本語
- **憑證鏈預檢查** — 合成前自動重排順序、辨別重複/無關憑證、self-signed 根憑證警告

### 下載

至 [Releases](https://github.com/LiNnnYc/5-in-1_pkcs12-converter/releases) 頁面取得最新的 portable 版本：

- **`PKCS12_Converter-x.y.z.zip`** — 解壓到任意位置即可執行 `PKCS12_Converter.exe`

支援 Windows 10 / 11 x64，無需系統管理員權限。

> **SmartScreen 警示說明：** 目前 binary 執行檔案未含 Code Signing 簽章，Windows 首次執行時可能會跳出「已保護您的電腦」視窗提示，請點擊「其他資訊」→「仍要執行」。Code Signing 程式碼簽章研擬中。

### 驗證 release 下載檔案的真偽

每個 Release zip 是透過 [Sigstore](https://www.sigstore.dev/) keyless 簽章機制由 GitHub Actions 簽發 attestation，可證明該檔案出自本專案 Repository 的 Release Workflow 且發布後未被竄改。

使用 [GitHub CLI](https://cli.github.com/) 驗證：

```bash
gh attestation verify PKCS12_Converter-1.0.1.zip --owner LiNnnYc
```

驗證成功後會顯示 workflow 路徑、commit SHA 與 Sigstore 的公開 log 紀錄。驗證過程無需 clone 本專案 repo。

### 從原始碼建置

```bash
git clone https://github.com/LiNnnYc/5-in-1_pkcs12-converter.git
cd 5-in-1_pkcs12-converter
npm install
# 將 OpenSSL + JRE 引擎置放於 engines/ 底下 — 詳細說明請見 engines/README.md
npm run dev          # 開發模式
npm test             # 執行測試
npm run package      # 打包成 portable .exe + .zip 至 release/
```

第三方引擎的取得與置放位置請參閱 [`engines/README.md`](engines/README.md)。

### 技術選型（堆疊）

Electron 33 · Vue 3.5 · Vite 6 · TypeScript 5.7 · vue-i18n 10 · electron-builder 25 · vitest 2

### 授權

[MIT](LICENSE) © LiNnnYc
