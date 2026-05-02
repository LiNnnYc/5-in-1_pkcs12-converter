# 五合一 PKCS #12 轉檔處理工具 — 技術規格書

> 版本：2.0
> 日期：2026-05-03
> 初版由 Claude Code 產生（2026-04-09），2.0 版根據 M1～M3 實作結果回饋修訂

---

## 目錄

0. [實作狀態](#0-實作狀態)
1. [功能需求](#1-功能需求)
2. [非功能需求](#2-非功能需求)
3. [技術選型](#3-技術選型)
4. [資料模型](#4-資料模型)
5. [應用程式架構](#5-應用程式架構)
6. [里程碑拆分](#6-里程碑拆分)
7. [已知風險與假設](#7-已知風險與假設)

---

## 0. 實作狀態

| 里程碑 | 狀態 | 說明 |
|--------|------|------|
| M1 — 核心 PKCS#12（合成（產製） / 抽取 / 檢視）+ Electron/Vue scaffold | ✅ 完成（2026-04-18） | 三大功能 + IPC 全接線 + portable 打包驗證 |
| M1.5 — 收尾技術債（packaging、openDirectory、timeout、錯誤映射、並行鎖） | ✅ 完成 | |
| M2 — JKS↔P12 + Log 系統 | ✅ 完成（2026-04-18） | Keytool + 最小 JRE 整合 |
| M2.1 — service 訊息 i18n 化 + P12→JKS 多 alias 使用者選擇 | ✅ 完成 | |
| M3 — UI polish、實機驗收、app icon、Settings Tab、首次 push GitHub | ✅ 主體完成（2026-05-02） | 第一輪/第二輪實機測試全綠；非 ASCII 路徑全域 bug 一勞永逸修復 |
| M3 收尾 — code signing 評估 + 清機 Win10/11 VM 安裝測試 | ⏳ 進行中 | |

測試：172/172（含 8 個 real-materials 整合測試 + 8 個 CJK 路徑整合測試）。

---

## 1. 功能需求

### 1.1 合成（產製） PKCS #12 檔案

| 項目 | 說明 |
|------|------|
| **描述** | 使用者提供私鑰檔案、憑證檔案（及選填的中繼憑證），合成（產製）一個 `.pfx` / `.p12` 檔案 |
| **輸入** | ① 私鑰檔案路徑（PEM/DER 格式）② 憑證檔案路徑（PEM/DER 格式）③ 中繼憑證檔案路徑（選填，可多個；可混用 PEM/DER）④ 匯出密碼（≥6 字元，UI 與 backend 雙重檢查）⑤ 輸出檔案路徑 ⑥ 加密演算法選擇（AES-256-CBC 或 PBE-SHA1-3DES） |
| **輸出** | 一個 PKCS #12 格式檔案（`.pfx` 或 `.p12`） |
| **對應 OpenSSL 指令** | AES-256-CBC：`openssl pkcs12 -export -out output.pfx -inkey key.pem -in cert.pem -certfile chain.pem -passout env:EXPORT_PASSWORD [-passin env:KEY_PASSWORD] -keypbe aes-256-cbc -certpbe aes-256-cbc -macalg sha256`<br>PBE-SHA1-3DES：`openssl pkcs12 -export -out output.pfx -inkey key.pem -in cert.pem -certfile chain.pem -passout env:EXPORT_PASSWORD [-passin env:KEY_PASSWORD] -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -legacy`<br>實際輸入路徑不直接送進 argv（見 §2.2 CJK 路徑處理）；`chain.pem` 為程式前處理後寫進 `.work/` 的 ASCII 暫存名；輸出檔先寫 `.work/` ASCII 暫存後 `fs.rename` 搬到使用者指定路徑 |
| **加密演算法** | • **AES-256-CBC**（預設）：現代加密標準<br>• **PBE-SHA1-3DES**：傳統格式（自動加 `-legacy` flag），供舊版 Windows / Java 8 以前相容 |
| **私鑰前處理** | 若私鑰有密碼保護，透過 `-passin env:KEY_PASSWORD` 讓 OpenSSL 自行解密，不產生無加密暫存私鑰檔。密碼僅透過環境變數傳入子程序 |
| **中繼憑證前處理** | `chainFiles[]` 可混用 PEM/DER。程式須先解析所有輸入、將 DER 轉為 PEM、移除重複憑證（SHA-256 key）、辨識並忽略無關憑證、依鏈建構演算法重排為正確鏈順序，最後合併為單一 `chain.pem` 供 OpenSSL `-certfile` 使用 |
| **鏈建構演算法** | 優先 **AKI ↔ SKI** 配對；無 AKI/SKI 時 fallback 為 **issuer DN ↔ subject DN** 比對；無法連結到主鏈的視為無關憑證（`CHAIN_HAS_EXTRA_CERTS`）。pool 為空（只有 leaf）也視為 linked |
| **預檢查確認流程** | 兩階段：`pkcs12:merge:precheck` 回傳 `precheckToken` + 整理後鏈 + 警告 → `pkcs12:merge` 帶回相同 token 與已確認 warning code 才執行；輸入檔變更或 token 不相符則拒絕並要求重新 precheck |
| **precheckToken 機制** | SHA-256 hex digest of：所有輸入檔（keyFile / certFile / chainFiles[]）依固定順序串接「絕對路徑 + 檔案大小（bytes）+ mtime（ms）」 |
| **憑證鏈警告** | `CHAIN_REORDERED`（順序錯誤已自動重排）、`CHAIN_HAS_EXTRA_CERTS`（含無關憑證已忽略）、`CHAIN_HAS_DUPLICATE_CERTS`、`CHAIN_HAS_ANCHOR`（含 self-signed root，使用者可選擇是否打入 `.pfx`）、`CHAIN_NOT_LINKED`（無法成鏈但仍允許強制輸出）。WarningDialog 對前四者統一渲染 `details.subjects` mono-font 清單 |
| **post-execution 落地檢查** | OpenSSL exit 0 不等於檔案真的寫出。合成完畢以 `existsSync` 確認 `.work/` 暫存實際存在，`fs.rename` 搬到使用者目的後再次確認 |
| **操作串接** | 合成（產製）成功後，提供「轉換為 JKS」按鈕（透過 `handoff` store 跨 Tab 預填，含 60s TTL 與 tab scrub cleanup） |
| **邊界條件** | 同初版規範。額外：匯出密碼最小長度 6 字元（UI inline 紅字提示 + 後端 `validateKeystorePassword` 雙重檢查）；輸出路徑可寫入採實際 create+delete probe（NTFS DACL 可靠），不依賴 `accessSync(W_OK)` |

### 1.2 從 PKCS #12 抽取私鑰與憑證

| 項目 | 說明 |
|------|------|
| **描述** | 從 `.pfx` / `.p12` 檔案中分離出私鑰檔案和憑證檔案 |
| **輸入** | ① PKCS #12 檔案路徑 ② PKCS #12 密碼 ③ 輸出目錄 ④ 憑證輸出格式（合併 / 拆分）⑤ Legacy 模式（`auto` / `on` / `off`，預設 `auto`） |
| **輸出** | 私鑰 `.key`（強制無加密 PEM）、伺服器憑證、中繼/CA 憑證 |
| **憑證輸出格式** | • **合併模式**：`private.key` + `certificates.pem`<br>• **拆分模式**：`private.key` + 以 CN 命名的 `.crt`（wildcard `*`→`-`、Windows 保留字元處理、80 字上限）；CN 衝突或缺失時 fallback 為 `server.crt` / `ca-1.crt` / `ca-2.crt` |
| **Legacy 模式** | 預設 `auto`：先以無 `-legacy` 嘗試，遇 OpenSSL legacy 相關 error pattern（`unsupported algorithm` / `pkcs12 pbe crypt error` 等）自動加 `-legacy` 重試；首次失敗但非已知 legacy pattern → 回 `LEGACY_MODE_UNCERTAIN` 警告請使用者改 `on` / `off` |
| **對應 OpenSSL 指令** | `pkcs12 -nocerts -noenc` / `-clcerts -nokeys` / `-cacerts -nokeys`，輸入透過 stdin Buffer pipe（見 §2.2），輸出寫 `.work/` 後搬移。OpenSSL 3.x 統一使用 `-noenc` 取代已棄用 `-nodes` |
| **邊界條件** | 同初版。額外：catch 區塊明確 mapping `EACCES`/`EPERM`/`EROFS`/`ENOENT`，其餘走 `error-mapper` |

### 1.3 檢視 PKCS #12 檔案資訊

| 項目 | 說明 |
|------|------|
| **描述** | 檢視 PKCS #12 檔案中包含的私鑰與憑證詳細資訊 |
| **輸入** | ① PKCS #12 檔案路徑 ② PKCS #12 密碼 |
| **輸出** | 結構化顯示：① 私鑰資訊（演算法、長度、SHA-256 SPKI 公鑰指紋）② 伺服器憑證（主體、發行者、有效期、序號、SAN、SKI、SHA-256 SPKI 公鑰指紋、SHA-1/SHA-256 fingerprint）③ 中繼/CA 憑證鏈資訊 ④ **PKCS#12 結構資訊**（generation modern/legacy、MAC 演算法、PBES2 KDF/Cipher/PRF/iteration、Shrouded Keybag、bags 清單） |
| **對應 OpenSSL 指令** | `pkcs12 -info -nokeys -noenc`（透過 stdin Buffer pipe），再以 `dumpPkcs12Info` 解析結構 |
| **邊界條件** | 密碼錯誤須明確提示；解析後資訊以結構化格式呈現，非 OpenSSL 原始輸出；legacy auto-retry 機制同 §1.2 |

### 1.4 JKS → PKCS #12 轉換

| 項目 | 說明 |
|------|------|
| **描述** | 將 Java KeyStore（`.jks` / `.keystore`）轉換為 PKCS #12 |
| **輸入** | ① JKS 檔案路徑 ② JKS 密碼 ③ 來源 alias（多 entry 時必須讓使用者選擇）④ Key 密碼（若與 store 不同）⑤ 輸出路徑 ⑥ 輸出密碼 |
| **alias 規則** | `jks:listAliases` 回傳 `AliasEntry[]`（含 `entryType: 'PrivateKeyEntry' \| 'trustedCertEntry'`）。AliasPicker UI 過濾出 `PrivateKeyEntry`：單一自動選；多個必選；零個拒絕執行。輸出 PKCS#12 alias 沿用選定來源 |
| **對應 Keytool 指令** | `keytool -importkeystore -noprompt -srckeystore ... -srcstoretype JKS -srcstorepass ... -srcalias ... [-srckeypass ...] -destkeystore ... -deststoretype PKCS12 -deststorepass ... -destkeypass ... -destalias ...`，附 JVM flags `-J-Duser.language=en -J-Duser.country=US -J-Dsun.jnu.encoding=UTF-8 -J-Dstdout.encoding=UTF-8 -J-Dstderr.encoding=UTF-8` |
| **操作串接** | 轉換成功後，提供「抽取私鑰與憑證」按鈕（handoff store 同 §1.1） |
| **邊界條件** | 同初版。額外：所有 Keytool 呼叫一律非互動模式；密碼最小長度 6（UI + backend 雙重）；改密碼/改檔案後自動清空 alias 選擇；keystore 輸入若含非 ASCII 路徑透過 `stageInputForCli` 暫存到 `.work/` |

### 1.5 PKCS #12 → JKS 轉換

| 項目 | 說明 |
|------|------|
| **描述** | 將 PKCS #12 轉換為 JKS |
| **輸入** | ① PKCS #12 檔案路徑 ② PKCS #12 密碼 ③ 輸出 JKS 路徑 ④ 輸出 JKS 密碼 ⑤ `aliasFilter`（多 alias 時必填） |
| **alias 規則** | 輸出 JKS alias 固定為 `1`。來源 PKCS#12 含多個 PrivateKeyEntry → 回 `PKCS12_MULTIPLE_ALIASES` warning + alias 清單，UI list→pick→convert 流程；轉換時帶 `aliasFilter` 限定來源 |
| **Legacy PFX 自動重包** | 來源若為 legacy PFX（PBE-SHA1-3DES 等舊式加密），keytool 無法直接讀。`repackageLegacyPfxAsAes` 先用 OpenSSL 把 PFX 重新匯出為 AES，再餵給 keytool；重包失敗回 `error.legacyP12RequiresRemerge` |
| **對應 Keytool 指令** | `keytool -importkeystore -noprompt -srckeystore ... -srcstoretype PKCS12 -srcstorepass ... [-srcalias ...] -destkeystore ... -deststoretype JKS -deststorepass ... -destkeypass ... -destalias 1`，JVM flags 同 §1.4 |
| **邊界條件** | 同初版。額外：error patterns 涵蓋 keytool stdout（不只 stderr）、modern keytool format 錯誤（`toderinputstream rejects tag type` 等）、`tampered with` / `password incorrect` / `alias not exist` |

### 1.6 設定（Settings Tab）

| 項目 | 說明 |
|------|------|
| **描述** | 提供使用者設定介面，含 4 區塊：語系 / Log / 引擎資訊 / 關於 |
| **持久化** | exe 同層 `settings.json`（atomic rename via `.tmp`）；schema `{ logging: { enabled, level }, locale }`；coerce 白名單（`debug/info/warn/error`、`zh-TW/en/ja`）。檔案不存在時用 in-memory defaults，僅在使用者主動改設定才落盤 |
| **預設值** | `logging.enabled = true`、`logging.level = info`、`locale` 由 i18n 偵測 |
| **Log 設定** | `enabled` toggle 下次啟動生效（fd / buffer 狀態反覆切換太複雜）；`level` runtime 即時生效（只是改 filter 變數）。UI 用 pending hint 區別兩者 |
| **語系切換** | sidebar 與 SettingsPage 兩處共用 `LanguageSelect` 元件，皆綁 `i18n.global.locale`；App.vue mount 時從 settings 還原、watch locale 變動寫回 settings（用 `restoredFromSettings` flag 避免初次 hydrate 觸發 watcher） |
| **引擎資訊** | cache 一次 `openssl version`（stdout）+ `keytool -J-version`（stderr）+ `enginesDir` 路徑；不在每次開頁重跑 |
| **關於** | app 版本、`.work/` 目錄路徑 + 開啟按鈕（透過 `shell:revealWorkDir` lazy mkdir）、GitHub 連結（`GITHUB_PUBLIC` flag-gated，repo 公開前為 disabled placeholder）|

### 1.7 Log 系統

| 項目 | 說明 |
|------|------|
| **描述** | session-based 結構化 log，輔助使用者回報問題 |
| **session ID** | 啟動時生成 8-hex 字元 ID，失敗 banner 顯示 `#xxxxxxxx` 給使用者報問題用 |
| **Log 等級** | `debug` / `info`（預設）/ `warn` / `error`；`level` filter 過濾 write，但 **error 永遠不被 filter 擋**（保留 lazy-open 安全網：停用時遇例外仍能 flush ring buffer 寫檔）|
| **啟用來源** | settings.logging.enabled / CLI flag / env var / `logs/.enabled` marker，任一觸發即啟用 |
| **密碼遮罩** | `log-redact.ts` 遞迴遮罩；`FORBIDDEN_ENV` Set 列出禁止寫入的環境變數名（`EXPORT_PASSWORD` / `KEY_PASSWORD` / `PFX_PASSWORD` / `*_STORE_PASS` 等）|
| **Rotation** | 14 檔 / 10MB；超過自動輪替 |
| **Lazy open** | 停用狀態下保留 in-memory ring buffer（最近 N 筆）；首次 error 才開檔寫入並 flush buffer。確保「平常不寫檔」+「真出事有跡可查」|

---

## 2. 非功能需求

### 2.1 可攜性（Portability）

- 程式為**免安裝**的可攜式應用，整個資料夾即為完整程式
- 不寫入 Registry、AppData 或任何程式資料夾外的位置（使用者指定的輸出路徑除外）
- 不依賴使用者系統上已安裝的任何軟體
- 暫存資料夾僅建立於 exe 同層的 `.work/`，不可使用系統 temp、`resources/app/` 內或程式資料夾外
- `settings.json` 落於 exe 同層；不含密碼欄位
- 提供兩種 portable 打包：單檔自解壓 `.exe` + 解壓即用 `.zip`（`electron-builder.yml` 雙 target）

### 2.2 安全性

- **密碼不落地**：密碼僅存記憶體
- **密碼傳遞**：
  - **OpenSSL**：`-passin env:VAR_NAME` / `-passout env:VAR_NAME`，透過 `execFile` 的 `env` 注入；不出現在 argv
  - **Keytool**：限制使然，密碼以 argv 傳入（`-srcstorepass` 等）；以 `execFile`（非 shell）呼叫降低暴露
- **execFile only**：所有 OpenSSL/Keytool 呼叫一律 `execFile` 與 argv 陣列；輸入只做合法性驗證，不做改變值的 shell escape
- **暫存檔清理**：`TempFileManager` finally + `app.on("will-quit")` 雙重保險；cleanup 改 `readdirSync` 確認空才 `rmdirSync`，不再強刪共用 workDir 內非自己 track 的檔案
- **CJK / 非 ASCII 路徑**：使用者選擇的路徑**永不直接送進 OpenSSL/Keytool argv**（OpenSSL 3.x 在 Windows 對 `OSSL_STORE` loader 的 `-in <非ASCII>` 拋 `Illegal byte sequence`）。輸入透過 `fs.readFile` 走 Win32 wide-char API 讀為 Buffer 後 stdin pipe；輸出走 `withSafeOutputPath`（`.work/` ASCII 暫存 + `fs.rename`，跨磁碟 `EXDEV` 退回 `copyFile + unlink`）。DER 二進位無法走 stdin（CRT text-mode 把 `\x1A` 當 EOF），改 stage 到 `.work/<outPath>.in.der` 後 `-in` 餵 ASCII path
- **Keytool CJK**：`-J-Dsun.jnu.encoding=UTF-8` 解 `Bad pathname`；`-J-Dstdout.encoding=UTF-8` / `-J-Dstderr.encoding=UTF-8` 解中文 alias mojibake
- **無網路存取**：零 telemetry、零更新檢查、零外部資源
- **shell:openExternal allow-list**：唯一允許的外連 host 為 `https://github.com`
- **密碼輸入遮罩**：預設遮罩，可切明文
- **指令注入防護**：不得以 shell 字串拼接

### 2.3 效能

- 一般大小檔案（< 10KB）操作應在 **3 秒內**完成
- UI 執行命令時須顯示進度指示，不可凍結介面
- OpenSSL 子程序 timeout **40 秒**（M1.5 從 30 秒上調，避免 keytool 冷啟動逾時誤判）
- Keytool 子程序 timeout **40 秒**

### 2.4 可用性

- 介面 5 個功能 Tab + 1 個 Settings 入口（sidebar 次要樣式 `.meta-link`，不做成 Tab）
- 檔案選擇一律使用系統原生對話框
- 錯誤訊息以使用者可理解的中文（或英 / 日）呈現，避免直接顯示原始 stderr；service `message` 帶 i18n key（`error.*` / `common.*`），原始 stderr 移到 `details`
- 必填欄位以紅點標示（`role=img` + `aria-label` + `title` tooltip）；紅點靠 input 欄左邊固定
- Row label 支援 i18n string 內嵌 `\n` 控制換行 + `text-wrap: balance` 自動平衡

### 2.5 可擴充性與 i18n

- vue-i18n 多語系：**繁體中文 zh-TW / 英文 en / 日本語 ja**（ja 從 en 翻譯而非中文，避開硬譯感）
- 三語系 JSON schema 同步維護；未用 key 定期清理
- 前後端分離；引擎可換版本（`engines/README.md` 記錄第三方來源與 jlink 裁剪指令）

---

## 3. 技術選型

### 3.1 整體架構

| 層級 | 選型 | 版本 | 理由 |
|------|------|------|------|
| **UI 層** | Electron | 33.x | 跨 Win 桌面、UI 彈性高 |
| **前端框架** | Vue 3 + Vite | Vue 3.5 / Vite 6 | 輕量、單檔元件 |
| **語言** | TypeScript | 5.7 | 型別安全 |
| **多語系** | vue-i18n | 10.x | 與 Vue 3 整合 |
| **打包** | electron-builder | 25.x | portable target（exe + zip 雙 target）|
| **測試** | vitest | 2.x | 快速、與 Vite 共用 config |
| **加密引擎** | 預編譯 OpenSSL（Windows x64） | 3.5.0 (FireDaemon) | 隨 portable 攜帶 |
| **JKS 引擎** | 預編譯 Keytool + 最小 JRE | Adoptium Temurin 21 + jlink | 隨 portable 攜帶 |

目標平台：Windows 10 / 11 x64

### 3.2 目錄結構（實作）

**原始碼結構：**

```
src/
├── main/                       # Electron main process
│   ├── index.ts
│   ├── ipc-handlers.ts         # IPC routing + guard wrapper（含並行鎖）
│   ├── preload.ts              # contextBridge API
│   ├── engines/
│   │   ├── openssl-runner.ts   # execFile + 40s timeout + env 密碼注入 + parent PASSWORD env 過濾
│   │   ├── keytool-runner.ts   # execFile + 40s timeout + UTF-8 / English locale JVM flags
│   │   └── output-parser.ts    # cert/key parser, classifyError, splitPemCerts
│   ├── services/
│   │   ├── chain-builder.ts    # PEM/DER 解析、去重、AKI/SKI 鏈建構、warnings
│   │   ├── merge-service.ts    # precheck token + merge
│   │   ├── extract-service.ts  # legacy auto-retry + merged/split
│   │   ├── view-service.ts     # 結構化解析（含 PKCS#12 結構資訊）
│   │   ├── convert-service.ts  # JKS↔P12 + legacy PFX 自動重包
│   │   ├── error-mapper.ts     # OpenSSL/Keytool error → i18n key
│   │   ├── settings-service.ts # settings.json 讀寫
│   │   └── engine-info-service.ts # openssl/keytool 版本快取
│   └── utils/
│       ├── path-resolver.ts
│       ├── sanitizer.ts        # ValidationFailureCode + 實際 create+delete write probe
│       ├── temp-file.ts        # .work/ 管理（readdir 確認空才 rmdir）
│       ├── safe-path.ts        # withSafeOutputPath / readFileForOpenssl / stageInputForCli
│       ├── logger.ts           # session-based + lazy-open + level filter
│       ├── log-redact.ts       # 遞迴密碼遮罩 + FORBIDDEN_ENV
│       └── log-rotate.ts       # 14 檔 / 10MB
├── renderer/
│   ├── App.vue                 # 5 Tab + Settings sidebar + lang select
│   ├── main.ts
│   ├── pages/                  # MergePage / ExtractPage / ViewPage / JksToP12Page / P12ToJksPage / SettingsPage
│   ├── components/             # FileSelector / MultiFileField / PasswordField / WarningDialog / ResultDisplay / CertificateCard / KeyInfoCard / AliasPicker / Row / LanguageSelect / Icon
│   ├── stores/
│   │   └── handoff.ts          # reactive singleton + 60s TTL + tab scrub cleanup
│   ├── i18n/
│   ├── locales/
│   │   ├── zh-TW.json
│   │   ├── en.json
│   │   └── ja.json
│   └── assets/
│       └── app-icon.svg
└── types/                      # 共用 domain types
tests/
└── smoke/                      # IPC handler smoke tests
build/
├── icon.svg                    # source of truth
├── icon.ico                    # multi-size 16~256
└── icon.png
scripts/
└── build-icon.mjs              # sharp + png-to-ico pipeline
engines/
├── openssl/                    # OpenSSL 3.5.0（gitignore，引擎本地放置）
└── jre-minimal/                # Temurin 21 + jlink 裁剪
```

**打包後結構：**

```
PKCS12_Converter/
├── PKCS12_Converter.exe
├── settings.json               # 使用者主動改設定才生成
├── .work/                      # 暫存（lazy mkdir，結束清理）
├── logs/                       # log 啟用時生成
├── resources/
│   ├── app/
│   └── engines/                # extraResources 打包進來
│       ├── openssl/
│       └── jre-minimal/
└── LICENSE
```

### 3.3 預編譯引擎來源

| 引擎 | 來源 | 說明 |
|------|------|------|
| OpenSSL | [FireDaemon OpenSSL](https://kb.firedaemon.com/support/solutions/articles/4000121705) 3.5.0 | 含 `legacy.dll`（OpenSSL 3.x legacy provider） |
| Keytool / JRE | [Adoptium Temurin](https://adoptium.net/) 21 + `jlink` | 模組裁剪：`java.base, java.logging, java.security.sasl, java.naming, jdk.crypto.ec, jdk.crypto.cryptoki, jdk.localedata`（注意 `java.security` 模組不存在；`java.security.sasl` 才是模組名） |

baseEnv 強制 `OPENSSL_MODULES=<engines/openssl/ossl-modules>` + `OPENSSL_CONF=""`。詳見 `engines/README.md`。

---

## 4. 資料模型

### 4.1 核心 Entity

```
┌─────────────────────┐
│   OperationRequest   │
├─────────────────────┤
│ type: OperationType  │  (MERGE | EXTRACT | VIEW | JKS_TO_P12 | P12_TO_JKS)
│ inputFiles: File[]   │
│ outputPath: string   │
│ passwords: object    │
│ options: object      │  (algorithm, certOutputMode, legacyMode, aliasFilter 等)
│ nextAction?: string  │  (操作串接)
└────────┬────────────┘
         ▼
┌─────────────────────────────┐
│  OperationResult             │
├─────────────────────────────┤
│ success: boolean             │
│ outputFiles: File[]          │
│ message: string              │  (i18n key, e.g. "error.passwordIncorrect")
│ details: object              │  (原始 stderr / VIEW 結果 / aliases)
│ warnings?: OperationWarning[]│
│ requiresConfirmation?        │
└──────────────────────────────┘
```

### 4.2 憑證資訊模型（VIEW 功能用）

```typescript
interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  signatureAlgorithm: string;
  subjectAltNames: string[];
  subjectKeyIdentifier: string;
  publicKeyFingerprintSha256: string;  // SPKI SHA-256
  fingerprint: {
    sha1: string;
    sha256: string;
  };
}

interface PrivateKeyInfo {
  algorithm: string;        // RSA, EC 等
  keySize: number;
  encrypted: boolean;
  publicKeyFingerprintSha256: string;  // 對應 cert 的 SPKI 指紋
}

interface Pkcs12StructureInfo {
  generation: 'modern' | 'legacy';
  mac: { algorithm: string; iteration: number } | null;
  bags: Array<{
    type: string;            // shrouded keyBag / certBag / etc.
    scheme?: string;
    kdf?: string;
    cipher?: string;
    prf?: string;
    iteration?: number;
    friendlyName?: string;
    localKeyId?: string;
  }>;
}

interface Pkcs12ViewResult {
  privateKey: PrivateKeyInfo | null;
  serverCert: CertificateInfo | null;
  chainCerts: CertificateInfo[];
  structure: Pkcs12StructureInfo;
}
```

### 4.3 警告與預檢查模型

```typescript
type WarningCode =
  | 'CHAIN_REORDERED'
  | 'CHAIN_HAS_EXTRA_CERTS'
  | 'CHAIN_HAS_DUPLICATE_CERTS'
  | 'CHAIN_HAS_ANCHOR'
  | 'CHAIN_NOT_LINKED'
  | 'LEGACY_MODE_UNCERTAIN'
  | 'PKCS12_MULTIPLE_ALIASES';

interface OperationWarning {
  code: WarningCode;
  message: string;          // i18n key
  requiresConfirmation: boolean;
  details?: Record<string, unknown>;  // e.g. { subjects: string[] } / { aliases: AliasEntry[] }
}

interface AliasEntry {
  name: string;
  entryType: 'PrivateKeyEntry' | 'trustedCertEntry';
}

interface MergePrecheckResult {
  precheckToken: string;
  keyMatchesCert: boolean;
  normalizedChainCerts: CertificateInfo[];
  droppedChainCerts: CertificateInfo[];
  anchorCert: CertificateInfo | null;
}
```

`precheckToken`：SHA-256 hex digest of「絕對路徑 + 檔案大小（bytes）+ mtime（ms）」按固定順序串接。

### 4.4 設定模型

```typescript
interface AppSettings {
  logging: {
    enabled: boolean;       // 預設 true；變更下次啟動生效
    level: 'debug' | 'info' | 'warn' | 'error';  // 預設 info；runtime 即時生效
  };
  locale: 'zh-TW' | 'en' | 'ja';
}

interface RuntimeInfo {
  version: string;
  sessionId: string;
  loggingEnabled: boolean;
  currentLogFile: string | null;
  logsDir: string;
  workDir: string;
}

interface EngineInfo {
  openssl: { version: string; path: string };
  keytool: { version: string; path: string };
  enginesDir: string;
}
```

---

## 5. 應用程式架構

### 5.1 IPC 通道設計（Renderer ↔ Main Process）

| 通道名稱 | 方向 | 說明 |
|----------|------|------|
| `pkcs12:merge:precheck` | R → M | 預檢查合成輸入、整理鏈、產生警告，回傳 `precheckToken` |
| `pkcs12:merge` | R → M | 合成（產製） PKCS#12（須帶 `precheckToken` + `confirmedWarningCodes`） |
| `pkcs12:extract` | R → M | 抽取私鑰與憑證 |
| `pkcs12:view` | R → M | 檢視檔案資訊 |
| `jks:toP12` | R → M | JKS → PKCS#12 |
| `jks:fromP12` | R → M | PKCS#12 → JKS（含 `aliasFilter`） |
| `jks:listAliases` | R → M | 列出 JKS alias（含 `entryType`） |
| `dialog:openFile` | R → M | 系統檔案選擇器 |
| `dialog:openDirectory` | R → M | 系統資料夾選擇器 |
| `dialog:saveFile` | R → M | 系統儲存對話框 |
| `settings:get` | R → M | 讀 `settings.json` |
| `settings:set` | R → M | 寫 `settings.json`（atomic）+ runtime apply log level |
| `engines:getInfo` | R → M | 取 OpenSSL / Keytool 版本資訊 |
| `app:getRuntimeInfo` | R → M | 取 app 版本 / sessionId / logging 狀態 / `.work` 路徑 |
| `shell:openExternal` | R → M | 開啟外部連結（嚴格 allow-list `https://github.com`） |
| `shell:revealWorkDir` | R → M | 開啟 `.work/`（lazy mkdir） |

合計 18 channel。並行鎖：`guard()` wrapper 對重複進入相同 channel 直接 early-return。

### 5.2 Main Process 模組劃分

見 §3.2 原始碼結構。

### 5.3 安全邊界（Context Isolation）

```
┌─────────────────────────────────────────────┐
│  Renderer Process (Vue 3)                    │
│  - contextIsolation + sandbox 強制 enable    │
│  - 不可直接存取 fs / child_process / Node API│
│  - 透過 contextBridge 暴露的 API 與 Main 溝通  │
└──────────────────┬──────────────────────────┘
                   │  IPC (invoke / handle)
┌──────────────────▼──────────────────────────┐
│  Main Process (Node.js)                      │
│  - 執行 OpenSSL / Keytool 子程序              │
│  - 所有檔案 I/O 操作                          │
│  - 輸入驗證與指令組裝                          │
│  - settings.json / log 寫入                  │
└─────────────────────────────────────────────┘
```

`autoHideMenuBar: true` + `Menu.setApplicationMenu(null)` 移除 application menu bar（雙重保險）。

---

## 6. 里程碑拆分

### M1 — 核心 PKCS#12 操作 ✅

合成（產製） / 抽取 / 檢視三大功能 + Electron/Vue scaffold + IPC 全接線 + portable 打包驗證。100/100 測試通過。

### M1.5 — 收尾技術債 ✅

`dialog:openDirectory` 新 channel；timeout 30→40s；三頁 catch 統一走 `error.internalError`；並行操作 early-return guard；Keytool 錯誤 pattern 補強。

### M2 — JKS↔P12 + Log 系統 ✅

Keytool runner（強制英文 locale + 40s timeout）、convert-service、JKS 3 IPC、JKS UI、handoff store 操作串接、roundtrip smoke test。Log 系統含 sessionId / lazy open / redact / rotate。138/138 測試通過。

### M2.1 — 收尾技術債 ✅

service 訊息全面 i18n key 化；P12→JKS 多 alias 強制使用者選擇；handoff payload 60s TTL + tab scrub；P12→JKS legacy PFX 自動重包。

### M3 — UI polish + 實機驗收 + Settings + 公開前置 ✅

第一輪實機 13 項分 5 批修正、第二輪驗收全綠、CJK 路徑全域 bug 一勞永逸修復（safe-path + stdin Buffer）、app icon、Settings Tab、ja 語系、首次 push GitHub、portable 雙 target（exe + zip）。172/172 測試通過。

**剩餘工作：**

- code signing 評估（採購 EV/OV vs 不簽 → SmartScreen 警示）
- 清機 Win10/11 VM 安裝測試
- 人類版 `README.md`（簡潔對外）
- 首次 GitHub Releases 上傳
- 翻 `GITHUB_PUBLIC` flag（repo 公開後）

**驗收條件：**

- 打包後資料夾可在乾淨 Windows 10/11 上直接執行
- 程式資料夾外無殘留檔案（除使用者指定輸出）
- 五項核心功能全數通過驗收

---

## 7. 已知風險與假設

### 風險

| # | 風險 | 影響 | 緩解措施 | 狀態 |
|---|------|------|----------|------|
| R1 | 預編譯 OpenSSL 版本相容性（DLL 相依） | 程式無法執行 | 使用 FireDaemon 3.5.0 + 強制 `OPENSSL_MODULES` / `OPENSSL_CONF=""`；`legacy.dll` 一併攜帶 | ✅ 已處理 |
| R2 | 最小化 JRE 體積 | 整體打包偏大 | jlink 6 模組裁剪後約 50MB；portable 可接受 | ✅ 已處理 |
| R3 | Electron 打包體積（150-200MB） | 程式可能 > 250MB | portable exe 約 100MB；客戶接受 | ✅ 已處理 |
| R4 | OpenSSL 指令注入 | 安全漏洞 | 全程 `execFile` + argv 陣列；輸入只做合法性驗證 | ✅ 已處理 |
| R5 | Windows Defender / 防毒誤報（未簽章） | 使用者無法執行 | M3 收尾評估 EV/OV 簽章；提供排除說明 | ⏳ 評估中 |
| R6 | OpenSSL 3.x Windows CJK 路徑 `Illegal byte sequence` | merge 不論對錯都顯示「私鑰與憑證不符」 | 一勞永逸：使用者路徑永不入 argv，輸入走 stdin Buffer pipe，輸出走 `.work/` ASCII 暫存 + `fs.rename` | ✅ 已處理（Session #20）|
| R7 | Keytool CJK alias / pathname 問題 | 中文 alias mojibake / `Bad pathname` | JVM flags `-J-Dsun.jnu.encoding=UTF-8` + `-J-Dstdout/stderr.encoding=UTF-8` | ✅ 已處理 |

### 假設

| # | 假設 | 說明 |
|---|------|------|
| A1 | 目標平台為 **Windows 10 / 11 x64** | 不支援 32 位元或其他 OS |
| A2 | 使用者具基本憑證概念 | 知道私鑰、憑證、PFX，但不熟 CLI |
| A3 | 輸入檔案為合法 PEM / DER / PFX / JKS | 程式做基本格式驗證，不處理嚴重損毀檔 |
| A4 | OpenSSL 使用 3.x 系列（實際 3.5.0） | 指令以 OpenSSL 3.x 為準（`-noenc` 取代 `-nodes`） |
| A5 | 程式以一般使用者權限執行 | 不需系統管理員 |
| A6 | 單一使用者操作 | 不考慮多人同時操作同份程式 |
| A7 | portable exe 自身位於 ASCII 路徑 | 若 exe 在 CJK 路徑，`.work/` 也會 CJK，stage / withSafeOutputPath 失效；後續可考慮啟動偵測 + GetShortPathName 8.3 fallback |
