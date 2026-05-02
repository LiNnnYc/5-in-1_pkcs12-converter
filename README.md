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
3. **View** — inspect a `.pfx` (private key info, full chain, SAN, SKI, fingerprints, PKCS #12 structure)
4. **JKS → P12** — convert a Java KeyStore into PKCS #12 (with alias picker for multi-entry stores)
5. **P12 → JKS** — convert a PKCS #12 into a Java KeyStore (legacy PFX is auto-repackaged)

### Highlights

- **Portable** — single folder, no installer, no registry writes, runs from a USB stick
- **Offline** — zero network requests, no telemetry, no update checks
- **Bundled engines** — ships with OpenSSL 3.5.0 + a minimal JRE 21 (jlink-trimmed); no system OpenSSL/Java required
- **Passwords never touch disk** — passed to OpenSSL via environment variables only
- **Multilingual** — Traditional Chinese / English / 日本語
- **Chain pre-check** — automatic chain reordering, duplicate detection, anchor warnings before generating

### Download

Grab the latest portable build from the [Releases](https://github.com/LiNnnYc/5-in-1_pkcs12-converter/releases) page. Two flavors:

- **`PKCS12_Converter-x.y.z.exe`** — single self-extracting portable executable
- **`PKCS12_Converter-x.y.z.zip`** — extract anywhere and run `PKCS12_Converter.exe`

Windows 10 / 11 x64. No admin rights required.

> **Note on SmartScreen warnings:** the binary is currently unsigned. Windows may show a "Windows protected your PC" dialog on first run — click *More info* → *Run anyway*. Code signing is on the roadmap.

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

五項常用 PKCS #12 / JKS 操作整合於單一 GUI：

1. **產製** — 私鑰 + 憑證 + 中繼憑證合成為 `.pfx`（AES-256-CBC 或 PBE-SHA1-3DES）
2. **抽取** — 從 `.pfx` 拆出私鑰與憑證（合併 `.pem` 或拆分 `.crt`）
3. **檢視** — 檢視 `.pfx` 內容（私鑰資訊、完整憑證鏈、SAN、SKI、fingerprint、PKCS#12 結構）
4. **JKS → P12** — Java KeyStore 轉 PKCS #12（多 entry 時可挑選 alias）
5. **P12 → JKS** — PKCS #12 轉 Java KeyStore（legacy PFX 會自動重包）

### 特色

- **免安裝可攜式** — 單一資料夾、不寫 Registry、可放隨身碟執行
- **完全離線** — 零網路請求、零 telemetry、零更新檢查
- **內建引擎** — 自帶 OpenSSL 3.5.0 + 最小 JRE 21（jlink 裁剪），不需系統安裝 OpenSSL / Java
- **密碼不落地** — 僅透過環境變數傳給 OpenSSL，不寫入任何檔案
- **多語系** — 繁體中文 / English / 日本語
- **鏈預檢** — 合成前自動重排順序、辨識重複/無關憑證、警告 self-signed root

### 下載

至 [Releases](https://github.com/LiNnnYc/5-in-1_pkcs12-converter/releases) 頁取得最新 portable 版本，兩種格式：

- **`PKCS12_Converter-x.y.z.exe`** — 單檔自解壓 portable 執行檔
- **`PKCS12_Converter-x.y.z.zip`** — 解壓到任意位置即可執行 `PKCS12_Converter.exe`

支援 Windows 10 / 11 x64，不需系統管理員權限。

> **SmartScreen 警示說明：** 目前 binary 未簽章，Windows 首次執行可能跳出「已保護您的電腦」提示，請點擊「其他資訊」→「仍要執行」。程式碼簽章研擬中。

### 從原始碼建置

```bash
git clone https://github.com/LiNnnYc/5-in-1_pkcs12-converter.git
cd 5-in-1_pkcs12-converter
npm install
# 將 OpenSSL + JRE 引擎放置於 engines/ 下 — 詳見 engines/README.md
npm run dev          # 開發模式
npm test             # 執行測試
npm run package      # 打包 portable .exe + .zip 至 release/
```

第三方引擎取得與放置方式請參閱 [`engines/README.md`](engines/README.md)。

### 技術選型

Electron 33 · Vue 3.5 · Vite 6 · TypeScript 5.7 · vue-i18n 10 · electron-builder 25 · vitest 2

### 授權

[MIT](LICENSE) © LiNnnYc
