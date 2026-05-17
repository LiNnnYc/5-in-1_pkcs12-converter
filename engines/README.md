# engines/

> 中文使用者請見下方的 [繁體中文版本](#繁體中文)。

## English

This folder holds the two third-party engine executables that the app shells out to. **Not tracked in git** (excluded by `.gitignore`).

- **End users** don't need to read any of this — just download Portable build from [Releases](https://github.com/LiNnnYc/5-in-1_pkcs12-converter/releases); the engines are already bundled.
- **Build / dev-mode developers** need to follow this guide to populate the folder locally.

At packaging time (`npm run package`), electron-builder copies the entire `engines/` folder into the portable exe via `extraResources`. Path resolution lives in `src/main/utils/path-resolver.ts`.

### Expected directory layout

```
engines/
├── openssl/
│   ├── openssl.exe
│   ├── libcrypto-3-x64.dll
│   ├── libssl-3-x64.dll
│   └── ossl-modules/
│       └── legacy.dll               # required to parse PBE-SHA1-3DES legacy PFX
└── jre-minimal/
    ├── bin/
    │   ├── java.exe
    │   ├── keytool.exe
    │   └── ... (other DLLs ship with Temurin)
    ├── conf/
    ├── lib/
    ├── legal/
    └── release
```

### OpenSSL 3.5.0 (Windows x64)

Source: [FireDaemon OpenSSL](https://kb.firedaemon.com/support/solutions/articles/4000121705) (FireDaemon publishes the official Windows static builds, legacy provider included).

Extract the following files from the installer / zip into `engines/openssl/`:

| File | Purpose |
|------|---------|
| `openssl.exe` | main executable |
| `libcrypto-3-x64.dll` | crypto runtime |
| `libssl-3-x64.dll` | SSL/TLS runtime |
| `ossl-modules/legacy.dll` | legacy provider; required to read older PBE-SHA1-3DES PFX files |

**Version compatibility**: this project is developed and tested against OpenSSL 3.5.0 (8 Apr 2025). Other 3.x versions should work in theory, but stderr/stdout formats can shift and may break the regexes in `output-parser.ts`.

Verify:
```bash
engines/openssl/openssl.exe version
# Expected: OpenSSL 3.5.0 8 Apr 2025 (Library: OpenSSL 3.5.0 8 Apr 2025)
```

### JRE-minimal (Temurin 21 + jlink)

Source: [Adoptium Temurin JDK 21](https://adoptium.net/temurin/releases/?version=21) (you must pick the **JDK**, not the JRE — `jlink` only ships with the JDK).

Module extraction command (run from the unpacked JDK root):

```bash
bin/jlink \
  --add-modules java.base,java.logging,java.security.sasl,java.naming,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.localedata \
  --strip-debug --no-header-files --no-man-pages --compress=2 \
  --output <project-path>/engines/jre-minimal
```

**Module rationale**:

| Module | Purpose |
|--------|---------|
| `java.base` | required |
| `java.logging` | keytool's internal logging |
| `java.security.sasl` | required by early-startup module resolution (residual from older module graphs) |
| `java.naming` | parses Distinguished Names |
| `jdk.crypto.ec` | EC curves (P-256 / P-384 etc.) |
| `jdk.crypto.cryptoki` | PKCS#11 / PKCS#12 keystore engine |
| `jdk.localedata` | handles CJK aliases / Subject DNs (mojibake otherwise) |

Verify:
```bash
engines/jre-minimal/bin/java.exe -version
# Expected: openjdk version "21.0.10" ... Temurin-21.0.10+7
engines/jre-minimal/bin/keytool.exe -help 2>&1 | head -3
```

### Security / trust sources

- Both engines are upstream official releases (the OpenSSL Project and Eclipse Adoptium); FireDaemon is a long-standing Windows pre-built distribution maintained within the OpenSSL community.
- All engine invocations use `execFile` rather than `exec` (no shell parsing), eliminating argv injection.
- `OPENSSL_MODULES` and `OPENSSL_CONF` are force-set inside `openssl-runner.ts` so the user's system-level OpenSSL configuration cannot interfere.
- See [spec.md](../spec.md) §5 / §7 for the full rationale.

---

## 繁體中文

本資料夾存放兩個第三方執行檔的轉檔引擎，**不推進 git**（被 `.gitignore` 排除）。

- **一般使用者** 不用閱讀以下內容 — 直接前往 [Releases](https://github.com/LiNnnYc/5-in-1_pkcs12-converter/releases) 下載 portable 版本 `.zip` 即可，引擎已內建。
- **build / dev mode 的開發者** 才需要照以下說明準備本機檔案。

打包後的（`npm run package`）electron-builder 會把 `engines/` 資料夾以 `extraResources` 形式包進 portable exe，路徑解析檔為 `src/main/utils/path-resolver.ts`。

## 預期目錄結構

```
engines/
├── openssl/
│   ├── openssl.exe
│   ├── libcrypto-3-x64.dll
│   ├── libssl-3-x64.dll
│   └── ossl-modules/
│       └── legacy.dll               # 解析 PBE-SHA1-3DES 舊式 PFX 必備檔案
└── jre-minimal/
    ├── bin/
    │   ├── java.exe
    │   ├── keytool.exe
    │   └── ... (其餘 DLL 由 Temurin 自帶)
    ├── conf/
    ├── lib/
    ├── legal/
    └── release
```

## OpenSSL 3.5.0（Windows x64）

來源：[FireDaemon OpenSSL](https://kb.firedaemon.com/support/solutions/articles/4000121705)（FireDaemon 提供 Windows 官方靜態 build，含 legacy provider）

從安裝包 / zip 取出以下檔案置放到 `engines/openssl/`：

| 檔名 | 說明 |
|------|------|
| `openssl.exe` | 主執行檔 |
| `libcrypto-3-x64.dll` | crypto runtime |
| `libssl-3-x64.dll` | SSL/TLS runtime |
| `ossl-modules/legacy.dll` | legacy provider，解析舊式 PBE-SHA1-3DES PFX 必備 |

**版本相容性**：本專案建立在 OpenSSL 3.5.0 (8 Apr 2025) 基礎上進行開發與測試。3.x 系列等版本理論上可用，但 stderr/stdout 的格式不同可能會影響 `output-parser.ts` 的 regex 運作。

驗證：
```bash
engines/openssl/openssl.exe version
# 預期輸出：OpenSSL 3.5.0 8 Apr 2025 (Library: OpenSSL 3.5.0 8 Apr 2025)
```

## JRE-minimal（Temurin 21 + jlink）

來源：[Adoptium Temurin JDK 21](https://adoptium.net/temurin/releases/?version=21)（不能選擇 JRE — 必須選擇 JDK，因為 jlink 使用上需要）

抽取模組的必要指令（在解壓縮後的 JDK 根目錄下執行）：

```bash
bin/jlink \
  --add-modules java.base,java.logging,java.security.sasl,java.naming,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.localedata \
  --strip-debug --no-header-files --no-man-pages --compress=2 \
  --output <專案路徑>/engines/jre-minimal
```

**模組說明**：

| 模組 | 用途 |
|------|------|
| `java.base` | 必備 |
| `java.logging` | keytool 內部日誌 |
| `java.security.sasl` | 啟動早期版本的必須檔案（舊 module 解析鏈的殘留痕跡） |
| `java.naming` | 處理 Distinguished Name |
| `jdk.crypto.ec` | EC 曲線（P-256 / P-384 等） |
| `jdk.crypto.cryptoki` | PKCS#11 / PKCS#12 keystore engine |
| `jdk.localedata` | 處理 CJK alias / Subject DN（缺少會 mojibake） |

驗證：
```bash
engines/jre-minimal/bin/java.exe -version
# 預期：openjdk version "21.0.10" ... Temurin-21.0.10+7
engines/jre-minimal/bin/keytool.exe -help 2>&1 | head -3
```

## 安全性 / 信任來源

- 兩個引擎都是官方上游 release（OpenSSL Project、Eclipse Adoptium），FireDaemon 是 OpenSSL 維護社群所提供的 Windows 預編譯版。
- 程式對引擎的呼叫一律使用 `execFile` 不使用 `exec`（不會經過 shell parsing），避免 argv 注入。
- `OPENSSL_MODULES`、`OPENSSL_CONF` 等環境變數在 `openssl-runner.ts` 內被強制設定，避免受到使用者的系統設定干擾。
- 詳細請見 [spec.md](../spec.md) §5 / §7。
