# engines/

本資料夾存放兩個第三方執行檔引擎，**不入 git**（被 `.gitignore` 排除）。

- **最終使用者** 不需要碰這裡 — 直接到 [Releases](https://github.com/LiNnnYc/5-in-1_pkcs12-converter/releases) 下載 portable `.exe` 即可，引擎已內嵌。
- **想自己 build / 跑 dev mode 的開發者** 才需要照下方說明準備本地檔案。

打包後（`npm run package`）electron-builder 會把 `engines/` 整包以 `extraResources` 形式放進 portable exe，路徑解析靠 `src/main/utils/path-resolver.ts`。

## 預期目錄結構

```
engines/
├── openssl/
│   ├── openssl.exe
│   ├── libcrypto-3-x64.dll
│   ├── libssl-3-x64.dll
│   └── ossl-modules/
│       └── legacy.dll               # 解 PBE-SHA1-3DES 舊式 PFX 必備
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

下載來源：[FireDaemon OpenSSL](https://kb.firedaemon.com/support/solutions/articles/4000121705)（FireDaemon 提供 Windows 官方靜態 build，含 legacy provider）

從安裝包 / zip 取出以下檔案放到 `engines/openssl/`：

| 檔名 | 說明 |
|------|------|
| `openssl.exe` | 主執行檔 |
| `libcrypto-3-x64.dll` | crypto runtime |
| `libssl-3-x64.dll` | SSL/TLS runtime |
| `ossl-modules/legacy.dll` | legacy provider，解舊式 PBE-SHA1-3DES PFX 必備 |

**版本相容性**：本專案在 OpenSSL 3.5.0 (8 Apr 2025) 上開發測試。3.x 系列其他版本理論上可用，但 stderr/stdout 格式變動可能會打破 `output-parser.ts` 的 regex。

驗證：
```bash
engines/openssl/openssl.exe version
# 預期：OpenSSL 3.5.0 8 Apr 2025 (Library: OpenSSL 3.5.0 8 Apr 2025)
```

## JRE-minimal（Temurin 21 + jlink）

來源：[Adoptium Temurin JDK 21](https://adoptium.net/temurin/releases/?version=21)（不是 JRE — 要 JDK，因為 jlink 需要）

裁剪指令（在解壓的 JDK 根目錄下執行）：

```bash
bin/jlink \
  --add-modules java.base,java.logging,java.security.sasl,java.naming,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.localedata \
  --strip-debug --no-header-files --no-man-pages --compress=2 \
  --output <專案路徑>/engines/jre-minimal
```

**模組組合說明**：

| 模組 | 用途 |
|------|------|
| `java.base` | 必備 |
| `java.logging` | keytool 內部日誌 |
| `java.security.sasl` | 早期版本啟動需要（舊 module 解析鏈遺留） |
| `java.naming` | 處理 Distinguished Name |
| `jdk.crypto.ec` | EC 曲線（P-256 / P-384 等） |
| `jdk.crypto.cryptoki` | PKCS#11 / PKCS#12 keystore engine |
| `jdk.localedata` | 處理 CJK alias / Subject DN（少了會 mojibake） |

驗證：
```bash
engines/jre-minimal/bin/java.exe -version
# 預期：openjdk version "21.0.10" ... Temurin-21.0.10+7
engines/jre-minimal/bin/keytool.exe -help 2>&1 | head -3
```

## 安全 / 信任

- 兩個引擎都是上游官方 release（OpenSSL Project、Eclipse Adoptium），FireDaemon 是 OpenSSL 維護者社群提供的 Windows 預編譯版。
- 程式對引擎調用一律走 `execFile` 不走 `exec`（不會經 shell parsing），避免 argv 注入。
- `OPENSSL_MODULES`、`OPENSSL_CONF` 等環境變數在 `openssl-runner.ts` 內被強制設定，避免讀到使用者系統的設定干擾。
- 詳見 [spec.md](../spec.md) §5 / §7。
