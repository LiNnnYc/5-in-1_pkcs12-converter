# M1 每日工作清單

> 里程碑 1：核心 PKCS#12 操作（合成 + 抽取 + 檢視）+ Electron/Vue scaffold
> 預估：10 個 Session，每 Session 控制在 200K token 以內
> 規格來源：[spec.md](spec.md)
> 任務編號規則：每個 Day 的主 checklist 使用固定 ID，格式為 `D{Day}-{序號}`，例如 `D3-02`。交接或中斷恢復時，請直接引用任務 ID。

## 總覽

| Day | 主題 | 產出檔案 | 預估行數 | 複雜度 | 依賴 |
|-----|------|---------|---------|--------|------|
| 1 | 專案骨架 + Electron Shell | 6-8 | 300-400 | 低-中 | 無 |
| 2 | 型別 + 工具模組 + IPC 骨架 | 5-6 | 500-600 | 中 | Day 1 |
| 3 | OpenSSL Runner + Output Parser | 3-4 | 700-900 | **高** | Day 2 |
| 4 | 憑證鏈建構演算法 | 2-3 | 500-700 | **極高** | Day 3 |
| 5 | Merge Service（precheck + token + 執行）| 2-3 | 400-550 | 高 | Day 4 |
| 6 | Extract + View Service | 3-4 | 600-750 | 高 | Day 3 |
| 7 | i18n + 錯誤映射 + Dialog | 4-5 | 500-700 | 中 | Day 2 |
| 8 | UI：App Shell + 合成頁 | 5-6 | 700-900 | 高 | Day 5, 7 |
| 9 | UI：抽取頁 + 檢視頁 | 3-4 | 600-800 | 中-高 | Day 6, 8 |
| 10 | 整合接線 + Smoke Tests | 4-6 | 500-700 | 中-高 | 全部 |

**合計：** ~38-49 檔案，~5300-7000 行

## 平行化機會

```
關鍵路徑（8 天）: Day1 → Day2 → Day3 → Day4 → Day5 → Day8 → Day9 → Day10
可平行:                               Day6（需 Day3）──┐
                                      Day7（需 Day2）──┤→ 合流 Day8
```

## 風險項目

| 風險 | 影響 Day | 緩解 |
|------|---------|------|
| OpenSSL 輸出格式因版本差異 | Day 3 | 多版本測試樣本、防禦性 regex |
| chain-builder 演算法處理循環參照 | Day 4 | visited set 防止無限迴圈 |
| MergePage 多狀態 UI 複雜度 | Day 8 | 使用明確狀態機 enum |
| OpenSSL 執行檔或 DLL 缺失（dev / package 環境） | Day 3+ | **Day 3 前確認 `engines/openssl/openssl.exe` 與相依 DLL 齊全**，並在交接文件記錄 runtime 狀態 |
| 憑證 / PFX 測試樣本不足，導致 parser 與 smoke test 覆蓋不完整 | Day 3、4、6、10 | Day 3 前先準備 RSA、EC、legacy PKCS#12、亂序 chain、含重複/無關 cert 的固定測資 |
| `.work/` 清理或敏感資料處理遺漏 | Day 2、5、6、10 | TempFileManager 統一管理暫存檔；測試涵蓋 success / fail / cancel；禁止把密碼寫入檔案、log、console |

---

## Day 1：專案骨架 + Electron Shell

**目標：** `npm run dev` 開啟 Electron 視窗，Context Isolation 生效。

**前置條件：** 無（greenfield）

### 任務

- [ ] `D1-01` 初始化 npm 專案，建立 `package.json`
  - deps: electron, vue 3, vite, @vitejs/plugin-vue, typescript, vue-i18n, vitest, electron-builder
  - scripts: dev, build, package, test
- [ ] `D1-02` 建立 `tsconfig.json`（renderer 用）+ `tsconfig.node.json`（main process 用）
- [ ] `D1-03` 建立 `vite.config.ts` — Vue 3 plugin, renderer build target
- [ ] `D1-04` 建立 `electron-builder.yml` — portable, win x64, extraResources: engines/
- [ ] `D1-05` 建立 `src/main/index.ts` — Electron 主程序入口
  - BrowserWindow: nodeIntegration:false, contextIsolation:true, sandbox:true
  - Dev mode: load Vite dev server URL
  - Prod mode: load built index.html
- [ ] `D1-06` 建立 `src/main/preload.ts` — contextBridge 骨架
  - `contextBridge.exposeInMainWorld('electronAPI', {...})`
  - 宣告所有 M1 IPC method typed stubs:
    - `mergePkcs12Precheck(params): Promise<OperationResult>`
    - `mergePkcs12(params): Promise<OperationResult>`
    - `extractPkcs12(params): Promise<OperationResult>`
    - `viewPkcs12(params): Promise<OperationResult>`
    - `openFileDialog(params): Promise<string[]>`
    - `saveFileDialog(params): Promise<string>`
- [ ] `D1-07` 建立 `src/renderer/index.html` — Vite 入口 HTML
- [ ] `D1-08` 建立 `src/renderer/main.ts` — Vue 3 createApp + mount
- [ ] `D1-09` 建立 `src/renderer/App.vue` — 最小佔位元件（顯示 "PKCS#12 Converter"）

### 驗證

```bash
npm run dev          # Electron 視窗成功開啟
tsc --noEmit         # 無型別錯誤
# Renderer DevTools console:
#   window.electronAPI          → 物件存在
#   require('fs')               → ReferenceError（context isolation 生效）
```

### 交接契約 → Day 2

- 專案結構存在，`npm run dev` / `npm test` / `npm run build` scripts 可用
- `src/main/preload.ts` 有所有 M1 IPC method stubs（尚未接上 handler）
- TypeScript 編譯無錯誤

---

## Day 2：型別定義 + 工具模組 + IPC 骨架

**目標：** 共用型別、輸入驗證、暫存管理、IPC 路由全部就位。

**前置條件：** Day 1（專案可啟動、TS 設定完成）

### 任務

- [ ] `D2-01` 建立 `src/types/index.ts` — 完整 domain types
  - `CertificateInfo` — subject, issuer, serialNumber, notBefore, notAfter, signatureAlgorithm, subjectAltNames[], subjectKeyIdentifier, authorityKeyIdentifier?, fingerprint{sha1, sha256}
  - `PrivateKeyInfo` — algorithm, keySize, encrypted
  - `Pkcs12ViewResult` — privateKey, serverCert, chainCerts[]
  - `WarningCode` — 6 值 union: CHAIN_REORDERED | CHAIN_HAS_EXTRA_CERTS | CHAIN_HAS_DUPLICATE_CERTS | CHAIN_HAS_ANCHOR | CHAIN_NOT_LINKED | LEGACY_MODE_UNCERTAIN
  - `OperationWarning` — code, message, requiresConfirmation, details?
  - `MergePrecheckResult` — precheckToken, keyMatchesCert, normalizedChainCerts[], droppedChainCerts[], anchorCert
  - `OperationResult<T>` — success, message, details?, warnings?, requiresConfirmation?, outputFiles?
  - 各 IPC channel 的 Request/Response 介面（MergeRequest, ExtractRequest, ViewRequest 等）
- [ ] `D2-02` 建立 `src/main/ipc-handlers.ts` — IPC 路由骨架
  - `ipcMain.handle('pkcs12:merge:precheck', ...)` — stub
  - `ipcMain.handle('pkcs12:merge', ...)` — stub
  - `ipcMain.handle('pkcs12:extract', ...)` — stub
  - `ipcMain.handle('pkcs12:view', ...)` — stub
  - `ipcMain.handle('dialog:openFile', ...)` — stub
  - `ipcMain.handle('dialog:saveFile', ...)` — stub
  - 所有 stub 回傳 `{ success: false, message: 'Not implemented' }`
- [ ] `D2-03` 建立 `src/main/utils/path-resolver.ts`
  - `resolveOpensslPath()` — app.isPackaged 判斷 dev/prod，回傳 engines/openssl/openssl.exe 絕對路徑
  - `resolveWorkDir()` — exe 同層 .work/ 路徑（dev 模式用 project root）
- [ ] `D2-04` 建立 `src/main/utils/sanitizer.ts`
  - `validateFilePath(path)` — 檔案存在且可讀
  - `validateOutputPath(path)` — 父目錄存在且可寫
  - `validatePassword(pw)` — 非空字串
  - `validateFileExtension(path, allowedExts[])` — 副檔名檢查
- [ ] `D2-05` 建立 `src/main/utils/temp-file.ts`
  - class `TempFileManager`
  - `resolveWorkDir()` — 回傳 .work/ 絕對路徑
  - `createTempFile(name)` — 在 .work/ 建立檔案，回傳路徑
  - `trackFile(path)` — 追蹤已建立的暫存檔
  - `cleanup()` — 刪除所有追蹤中的檔案
  - `registerProcessExitHandlers()` — beforeExit, SIGINT, uncaughtException 時自動 cleanup
- [ ] `D2-06` 建立 `src/main/utils/__tests__/sanitizer.test.ts` — 路徑合法性驗證測試
- [ ] `D2-07` 建立 `src/main/utils/__tests__/temp-file.test.ts` — 建立/追蹤/cleanup 流程測試

### 驗證

```bash
tsc --noEmit                    # 型別無誤
npm test -- sanitizer           # 路徑驗證測試通過
npm test -- temp-file           # 暫存管理測試通過
```

### 交接契約 → Day 3

- `src/types/index.ts` 可 import 所有 domain types
- `path-resolver` 可回傳 openssl.exe 路徑（dev 和 prod 模式）
- `TempFileManager` 可建立/追蹤/清理 .work/ 暫存
- `sanitizer` 可驗證檔案路徑、輸出路徑、密碼
- IPC 6 通道已註冊（stub）

---

## Day 3：OpenSSL 引擎層

**目標：** 可透過 Node.js 執行 OpenSSL 指令並將文字輸出解析為結構化物件。

**前置條件：** Day 2（types、path-resolver）

> **重要：** 此 Day 開始前需確認 `engines/openssl/openssl.exe` 存在。若尚未取得，測試可暫用 mock，但需記錄於交接文件。

### 任務

- [ ] `D3-01` 建立 `src/main/engines/openssl-runner.ts`
  - `runOpenssl(args[], options?)` — execFile wrapper
    - 使用 path-resolver 取得 openssl.exe 路徑
    - 30 秒 timeout
    - env var 密碼注入（透過 options.env: { EXPORT_PASSWORD, KEY_PASSWORD, PFX_PASSWORD }）
    - 回傳 `{ stdout, stderr, exitCode }`
  - `parseCertificateText(pemPath)` — `openssl x509 -text -noout -in <path>`
  - `parseKeyInfo(keyPath)` — `openssl rsa -text -noout -in <path>`（或 ec -text）
  - `checkKeyMatchesCert(keyPath, certPath)` — 比較 modulus/public key hash
  - `convertDerToPem(derPath, outPath)` — `openssl x509 -inform DER -outform PEM`
  - `detectFormat(filePath)` — 讀取檔頭判斷 PEM（`-----BEGIN`）或 DER
- [ ] `D3-02` 建立 `src/main/engines/output-parser.ts`
  - `parseCertInfo(opensslText): CertificateInfo` — regex 擷取：
    - Subject（CN, O, OU 等）
    - Issuer
    - Serial Number（hex）
    - Validity（Not Before / Not After）
    - Signature Algorithm
    - Subject Alternative Name（DNS, IP, URI）
    - Subject Key Identifier（SKI, hex）
    - Authority Key Identifier（AKI, hex）
    - Fingerprint SHA-1 / SHA-256
  - `parsePrivateKeyInfo(opensslText): PrivateKeyInfo` — 擷取 algorithm, keySize
  - `classifyError(stderr): 'legacy' | 'password' | 'format' | 'timeout' | 'unknown'`
    - Legacy patterns: `unsupported algorithm`, `pkcs12 pbe crypt error`, `PKCS12 routines`, `EVP_PBE_alg_add_type`
    - Password patterns: `mac verify failure`, `bad decrypt`
    - Format patterns: `unable to load`, `no certificate`
- [ ] `D3-03` 建立 `src/main/engines/__tests__/output-parser.test.ts` — 10-12 test cases
  - 標準 RSA 2048 憑證全欄位解析
  - EC P-256 key info 解析
  - 含多筆 SAN（DNS + IP）的憑證
  - 不含 SKI/AKI 的舊憑證（欄位為空/undefined）
  - 多憑證 PEM block 分割
  - Legacy error stderr → 分類為 'legacy'
  - Password error stderr → 分類為 'password'
  - 未知 error stderr → 分類為 'unknown'
  - 空 stdout 處理

### 驗證

```bash
npm test -- output-parser        # 全部 test cases 通過
```

### 交接契約 → Day 4 / Day 6

openssl-runner exports:
- `runOpenssl`, `parseCertificateText`, `parseKeyInfo`
- `checkKeyMatchesCert`, `convertDerToPem`, `detectFormat`

output-parser exports:
- `parseCertInfo`, `parsePrivateKeyInfo`, `classifyError`

---

## Day 4：憑證鏈建構演算法

**目標：** 完成 M1 最複雜的單一模組 — 憑證鏈解析、去重、排序、anchor 偵測、警告產生。

**前置條件：** Day 3（openssl-runner、output-parser）

### 任務

- [ ] `D4-01` 建立 `src/main/services/chain-builder.ts`
  - `parseCertificateFiles(files[]): Promise<ParsedCert[]>`
    - 讀取每個檔案
    - detectFormat() 判斷 PEM/DER
    - DER → convertDerToPem()
    - parseCertificateText() + parseCertInfo() 取得結構化資訊
    - 回傳 `ParsedCert[]`（CertificateInfo + rawPem + filePath）
  - `deduplicateCerts(certs[]): { unique[], duplicates[] }`
    - 以 fingerprint.sha256 去重
  - `buildChain(serverCert, candidateCerts[]): { chain[], unrelated[], anchor? }`
    - 從 serverCert 開始向上走
    - **優先**：child.authorityKeyIdentifier === parent.subjectKeyIdentifier（AKI↔SKI）
    - **Fallback**：child.issuer === parent.subject（DN 字串比對）
    - 用 visited Set 防止循環參照
    - 遞迴直到找不到父 or 遇到 self-signed
    - 偵測 anchor：subject === issuer 的自簽憑證
    - 收集未被鏈到的憑證為 unrelated
  - `generateChainWarnings(buildResult, originalOrder): OperationWarning[]`
    - `CHAIN_REORDERED` — chain 順序與原始輸入不同
    - `CHAIN_HAS_DUPLICATE_CERTS` — deduplicateCerts 發現重複
    - `CHAIN_HAS_EXTRA_CERTS` — 有 unrelated 憑證被過濾
    - `CHAIN_HAS_ANCHOR` — chain 包含 self-signed root
    - `CHAIN_NOT_LINKED` — chain 無法完整串接（有斷裂）
  - `writeChainPem(chain[], workDir): string`
    - 串接所有 rawPem 寫入 .work/chain.pem
    - 回傳檔案路徑
- [ ] `D4-02` 建立 `src/main/services/__tests__/chain-builder.test.ts` — 8-10 cases
  - 3 層正確鏈（server → intermediate → root），不產生 warning
  - 逆序輸入（root, server, intermediate）→ 自動重排 + CHAIN_REORDERED
  - 含重複憑證 → 去重 + CHAIN_HAS_DUPLICATE_CERTS
  - 含無關憑證 → 過濾 + CHAIN_HAS_EXTRA_CERTS
  - 含 self-signed anchor → CHAIN_HAS_ANCHOR
  - 無 AKI/SKI 的憑證 → DN fallback 仍能成鏈
  - 完全無法成鏈 → CHAIN_NOT_LINKED
  - 混合場景（部分可鏈 + 部分無關 + 1 重複 + anchor）→ 多個 warning 同時產生

### 驗證

```bash
npm test -- chain-builder        # 全部通過
```

### 交接契約 → Day 5

chain-builder exports:
- `parseCertificateFiles`, `deduplicateCerts`, `buildChain`
- `generateChainWarnings`, `writeChainPem`

---

## Day 5：合成服務（Precheck + Token + 執行）

**目標：** 完整的二步驟合成流程 — precheck 產生 token + warnings，merge 驗證 token 後執行 OpenSSL。

**前置條件：** Day 4（chain-builder）、Day 3（openssl-runner）、Day 2（sanitizer、temp-file）

### 任務

- [ ] `D5-01` 建立 `src/main/services/merge-service.ts`
  - `mergePrecheck(params): Promise<OperationResult<MergePrecheckResult>>`
    1. sanitizer 驗證所有輸入檔案存在
    2. `checkKeyMatchesCert()` 確認 key↔cert 匹配
    3. `parseCertificateFiles()` + `deduplicateCerts()` + `buildChain()`
    4. `generateChainWarnings()`
    5. `computePrecheckToken()` — SHA-256(各檔絕對路徑 + size(bytes) + mtime(ISO8601))
    6. 回傳 MergePrecheckResult（token, keyMatchesCert, normalizedChain, dropped, anchor）
  - `mergePkcs12(params): Promise<OperationResult>`
    1. `validatePrecheckToken()` — 重算 hash 比對
    2. 檢查 `confirmedWarningCodes` 包含所有 requiresConfirmation 的 warnings
    3. `writeChainPem()` 到 .work/（若有 chain certs）
    4. 組裝 OpenSSL pkcs12 -export 指令：
       - AES-256-CBC: `-keypbe aes-256-cbc -certpbe aes-256-cbc -macalg sha256`
       - PBE-SHA1-3DES: `-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES`
    5. 密碼注入: `-passout env:EXPORT_PASSWORD`, `-passin env:KEY_PASSWORD`（若有）
    6. `runOpenssl()` 執行
    7. finally: TempFileManager.cleanup()
    8. 回傳 OperationResult（成功含 outputFiles）
  - `computePrecheckToken(files[]): string` — helper
  - `validatePrecheckToken(token, files[]): boolean` — helper
- [ ] `D5-02` 建立 `src/main/services/__tests__/merge-service.test.ts`
  - precheck 回傳有效 token 和 MergePrecheckResult
  - merge with valid token 成功執行
  - merge with stale token（模擬 mtime 改變）→ 拒絕
  - merge 未確認必要 warning → 拒絕
  - AES-256-CBC 指令參數正確
  - PBE-SHA1-3DES 指令參數正確
  - 成功後 .work/ 為空
  - 失敗後 .work/ 仍為空

### 驗證

```bash
npm test -- merge-service        # 全部通過
```

### 交接契約 → Day 8

merge-service exports:
- `mergePrecheck(params)`, `mergePkcs12(params)`

---

## Day 6：抽取服務 + 檢視服務

**目標：** extract 含 legacy auto-detection 和兩種輸出模式；view 含結構化解析。

**前置條件：** Day 3（openssl-runner、output-parser）

> **可平行：** 此 Day 僅依賴 Day 3，可與 Day 4-5 平行執行。

### 任務

- [ ] `D6-01` 建立 `src/main/services/extract-service.ts`
  - `extractPkcs12(params): Promise<OperationResult>`
    1. sanitizer 驗證輸入
    2. Legacy mode 決策：
       - `auto`：先不加 `-legacy` 執行，`classifyError(stderr)`:
         - 'legacy' → 加 `-legacy` 重試
         - 'password' → 直接報錯
         - 'unknown' → 回傳 LEGACY_MODE_UNCERTAIN warning
       - `on`：強制加 `-legacy`
       - `off`：不加 `-legacy`
    3. 執行 3 條 OpenSSL 指令：
       - `pkcs12 -in <pfx> -nocerts -noenc -passin env:PFX_PASSWORD -out <workdir>/private.key`
       - `pkcs12 -in <pfx> -clcerts -nokeys -passin env:PFX_PASSWORD -out <workdir>/server.pem`
       - `pkcs12 -in <pfx> -cacerts -nokeys -passin env:PFX_PASSWORD -out <workdir>/ca.pem`
    4. certOutputMode 組裝：
       - `merged`：合併所有憑證 → `<outputDir>/certificates.pem`
       - `split`：server cert → `<outputDir>/server.crt`，CA 依序 → `ca-1.crt`, `ca-2.crt`...
    5. 私鑰 → `<outputDir>/private.key`
    6. 處理邊界：無 private key、無 CA certs（跳過並告知）
    7. cleanup .work/
    8. 回傳 outputFiles 清單
- [ ] `D6-02` 建立 `src/main/services/view-service.ts`
  - `viewPkcs12(params): Promise<OperationResult<Pkcs12ViewResult>>`
    1. sanitizer 驗證輸入
    2. 執行 `openssl pkcs12 -info -nokeys -noenc -passin env:PFX_PASSWORD`
       - 同樣用 legacy auto-detection 邏輯
    3. 用 output-parser 解析輸出：
       - PrivateKeyInfo
       - ServerCert CertificateInfo
       - ChainCerts CertificateInfo[]
    4. 回傳 Pkcs12ViewResult
- [ ] `D6-03` 建立 `src/main/services/__tests__/extract-service.test.ts`
  - merged 模式輸出正確檔名（private.key + certificates.pem）
  - split 模式輸出正確檔名（private.key + server.crt + ca-1.crt）
  - legacy auto → classifyError 為 'legacy' → 重試成功
  - legacy auto → classifyError 為 'unknown' → LEGACY_MODE_UNCERTAIN
  - 無 CA certs → 只輸出 key + server cert
  - 密碼錯誤 → 報錯
- [ ] `D6-04` 建立 `src/main/services/__tests__/view-service.test.ts`
  - happy path：回傳完整 Pkcs12ViewResult
  - 無 chain certs：chainCerts 為空陣列
  - 密碼錯誤 → 報錯

### 驗證

```bash
npm test -- extract-service      # 全部通過
npm test -- view-service         # 全部通過
```

### 交接契約 → Day 9

- extract-service exports `extractPkcs12`
- view-service exports `viewPkcs12`

---

## Day 7：i18n + 錯誤映射 + Dialog Handlers

**目標：** 完整繁中語系、OpenSSL 錯誤對應中文訊息、原生檔案對話框。

**前置條件：** Day 2（types、scaffold）

> **可平行：** 此 Day 僅依賴 Day 2，可與 Day 3-6 平行執行。

### 任務

- [ ] `D7-01` 建立 `src/renderer/i18n/index.ts`
  - `createI18n({ locale: 'zh-TW', fallbackLocale: 'en', messages })`
- [ ] `D7-02` 建立 `src/renderer/locales/zh-TW.json` — 完整繁中語系（預估 150-200 key）
  - `nav` — 合成、抽取、檢視
  - `merge` — 所有欄位標籤、按鈕文字、操作提示
  - `extract` — 所有欄位標籤、模式說明
  - `view` — 所有欄位標籤、區塊標題
  - `cert` — 憑證欄位標籤（subject, issuer, serial, validity, SAN, SKI, AKI, fingerprint 等）
  - `warning` — 6 種 WarningCode 的使用者友善中文訊息
  - `error` — 密碼錯誤、檔案不存在、格式無效、key 不匹配、timeout、路徑不可寫、密碼為空、覆寫確認等
  - `common` — 確認、取消、載入中、成功、失敗、瀏覽...
- [ ] `D7-03` 建立 `src/renderer/locales/en.json` — 同結構英文 stub
- [ ] `D7-04` 建立 `src/main/services/error-mapper.ts`
  - `mapError(stderr, exitCode): { i18nKey: string, details?: string }`
  - 映射清單：
    - 密碼錯誤 → `error.passwordIncorrect`
    - 格式錯誤 → `error.formatInvalid`
    - Key↔cert 不匹配 → `error.keyMismatch`
    - 檔案不存在 → `error.fileNotFound`
    - 權限不足 → `error.outputNotWritable`
    - Timeout → `error.timeout`
    - Legacy 相關 → `error.legacyRequired`
    - 未知 → `error.unknown`
- [ ] `D7-05` 更新 `src/main/ipc-handlers.ts` — 實作 dialog handlers
  - `dialog:openFile` → `dialog.showOpenDialog({ filters, properties })`
  - `dialog:saveFile` → `dialog.showSaveDialog({ filters, defaultPath })`
- [ ] `D7-06` 更新 `src/renderer/main.ts` — 掛載 vue-i18n plugin

### 驗證

```bash
npm run dev                      # vue-i18n 初始化無錯誤
npm test -- error-mapper         # 8+ error patterns 正確映射
# 手動：在 renderer 呼叫 window.electronAPI.openFileDialog() 開啟原生對話框
```

### 交接契約 → Day 8 / Day 9

- `$t()` 在任何 Vue 元件中可用
- `zh-TW.json` 和 `en.json` 有完整且結構一致的 key
- `error-mapper` 可將 OpenSSL stderr 轉換為 i18n key
- `dialog:openFile` / `dialog:saveFile` IPC 可正常運作

---

## Day 8：UI — App Shell + 合成頁面

**目標：** 主導航（3 Tab）+ 完整 MergePage 含 precheck→warning→merge 狀態流。

**前置條件：** Day 5（merge-service）、Day 7（i18n、dialog）

### 任務

- [ ] `D8-01` 改寫 `src/renderer/App.vue`
  - Tab bar 導航：合成 / 抽取 / 檢視
  - Active tab 狀態管理
  - Conditional component rendering（MergePage / ExtractPage / ViewPage）
  - 全域 loading overlay
- [ ] `D8-02` 建立 `src/renderer/components/FileSelector.vue`
  - Props: label, accept(filter), multiple
  - 顯示選中的檔案路徑
  - 「瀏覽」按鈕 → 呼叫 dialog:openFile IPC
  - Multiple 模式：可新增/移除多個檔案
- [ ] `D8-03` 建立 `src/renderer/components/PasswordInput.vue`
  - Props: label, modelValue, placeholder, optional
  - v-model 雙向綁定
  - 密碼遮罩 / 明文切換按鈕
- [ ] `D8-04` 建立 `src/renderer/components/WarningDialog.vue`
  - Props: warnings(OperationWarning[]), visible
  - 每個 requiresConfirmation 的 warning 有 checkbox
  - 全部確認後「繼續」按鈕才啟用
  - 「取消」按鈕
  - Emit: confirm(confirmedCodes[]), cancel
- [ ] `D8-05` 建立 `src/renderer/components/ResultDisplay.vue`
  - Props: result(OperationResult)
  - 成功 / 失敗狀態圖示
  - 輸出檔案路徑清單
  - Slot: 額外動作按鈕
- [ ] `D8-06` 建立 `src/renderer/pages/MergePage.vue`
  - 輸入區：
    - FileSelector: 私鑰檔案
    - PasswordInput: 私鑰密碼（optional，僅私鑰加密時需要）
    - FileSelector: 憑證檔案
    - FileSelector: 中繼憑證（multiple）
    - PasswordInput: 匯出密碼（必填）
    - Algorithm dropdown: AES-256-CBC（預設）/ PBE-SHA1-3DES
    - FileSelector: 輸出路徑（saveFile dialog）
  - 狀態機：`idle → prechecking → warnings → confirming → merging → success | error`
  - 「預檢」按鈕 → pkcs12:merge:precheck IPC
  - WarningDialog 顯示 precheck 回傳的 warnings
  - 「合成」按鈕 → pkcs12:merge IPC（帶 token + confirmedWarnings）
  - ResultDisplay 顯示結果
  - 「轉換為 JKS」佔位按鈕（disabled, tooltip: "M2 功能"）
  - 覆寫確認：若輸出檔已存在，先彈窗確認

### 驗證

```bash
npm run dev
# 手動驗證：
#   三個 Tab 可切換（合成 active、抽取/檢視 顯示佔位）
#   MergePage：所有 FileSelector 可開啟對話框
#   MergePage：PasswordInput 可切換明文/遮罩
#   MergePage：Algorithm dropdown 可選擇
#   MergePage：點「預檢」→ 呼叫 IPC（console 可見）
#   MergePage：WarningDialog 顯示 + 確認流程
#   所有文字使用 $t() i18n
```

### 交接契約 → Day 9

- App Shell（三 Tab 導航）完成
- 共用元件可用：FileSelector, PasswordInput, WarningDialog, ResultDisplay
- MergePage 完整 UI 流程可操作

---

## Day 9：UI — 抽取頁面 + 檢視頁面

**目標：** 完成剩餘兩個功能頁面的 UI。

**前置條件：** Day 6（extract/view service）、Day 8（App Shell + 共用元件）

### 任務

- [ ] `D9-01` 建立 `src/renderer/pages/ExtractPage.vue`
  - FileSelector: PFX 檔案
  - PasswordInput: PFX 密碼
  - 輸出目錄選擇
  - certOutputMode toggle：合併（`certificates.pem`）/ 拆分（`.crt`）
  - legacyMode 選擇器：auto（預設）/ on / off，含說明文字
  - 「抽取」按鈕 → pkcs12:extract IPC
  - LEGACY_MODE_UNCERTAIN 處理：顯示提示，引導使用者改選 on/off 重試
  - ResultDisplay：輸出檔案清單
- [ ] `D9-02` 建立 `src/renderer/pages/ViewPage.vue`
  - FileSelector: PFX 檔案
  - PasswordInput: PFX 密碼
  - 「檢視」按鈕 → pkcs12:view IPC
  - 結果區：accordion / card layout
    - KeyInfoCard 顯示 PrivateKeyInfo
    - CertificateCard 顯示 serverCert
    - CertificateCard × N 顯示 chainCerts[]
  - 處理：無 private key、無 chain certs
- [ ] `D9-03` 建立 `src/renderer/components/CertificateCard.vue`
  - Props: cert(CertificateInfo), title, collapsible
  - 結構化顯示所有欄位（label 用 i18n）：
    - Subject, Issuer, Serial Number
    - Not Before ~ Not After
    - Signature Algorithm
    - Subject Alternative Names（列表）
    - Subject Key Identifier
    - Authority Key Identifier
    - Fingerprint SHA-1, SHA-256
  - 可摺疊/展開
- [ ] `D9-04` 建立 `src/renderer/components/KeyInfoCard.vue`
  - Props: keyInfo(PrivateKeyInfo)
  - 顯示：Algorithm badge + Key Size (bits)

### 驗證

```bash
npm run dev
# 手動驗證：
#   ExtractPage：選檔、密碼、切換 merged/split、切換 legacy mode、執行
#   ViewPage：選檔、密碼、查看結構化輸出
#   CertificateCard：所有欄位正確顯示、可摺疊
#   所有文字使用 $t() i18n，無硬編碼中文
```

### 交接契約 → Day 10

- 三個功能頁面全部完成
- 所有 UI 元件可用
- 所有 IPC 呼叫已接線（雖然 handler 仍是 stub / 部分實作）

---

## Day 10：整合接線 + Smoke Tests + 收尾

**目標：** IPC handlers 接上真實 service、端對端可運作、所有 smoke tests 通過。

**前置條件：** Day 1-9 全部完成

### 任務

- [ ] `D10-01` 最終化 `src/main/ipc-handlers.ts` — 替換所有 stub
  - `pkcs12:merge:precheck` → `try { await mergePrecheck(params) } catch(e) { mapError → OperationResult }`
  - `pkcs12:merge` → `try { await mergePkcs12(params) } catch(e) { ... }`
  - `pkcs12:extract` → `try { await extractPkcs12(params) } catch(e) { ... }`
  - `pkcs12:view` → `try { await viewPkcs12(params) } catch(e) { ... }`
  - 每個 handler 的 catch 使用 error-mapper 轉換
- [ ] `D10-02` 更新 `src/main/index.ts`
  - `app.whenReady()` 中呼叫 ipc-handlers 註冊
  - `app.on('will-quit')` 清理 .work/
- [ ] `D10-03` 建立 `tests/smoke/merge.test.ts`
  - happy path：valid key + cert + 1 chain → .pfx 產出
  - warning path：亂序 chain → CHAIN_REORDERED + 自動重排
  - force path：unlinked chain + user confirms → 強制合成
- [ ] `D10-04` 建立 `tests/smoke/extract.test.ts`
  - merged output：.pfx → private.key + certificates.pem
  - split output：.pfx → private.key + server.crt + ca-1.crt
  - legacy auto：SHA1-3DES .pfx → 自動偵測 + -legacy 重試
- [ ] `D10-05` 建立 `tests/smoke/view.test.ts`
  - happy path：所有欄位正確解析
  - no chain：只有 key + server cert
- [ ] `D10-06` 建立 `tests/smoke/error-and-cleanup.test.ts`
  - 密碼錯誤 → 回傳 error.passwordIncorrect
  - 檔案不存在 → 回傳 error.fileNotFound
  - .work/ 清理：成功操作後目錄為空
  - .work/ 清理：失敗操作後目錄仍為空

### 驗證

```bash
npm test                         # 全部 unit + smoke tests 通過
npm run build                    # 建置無錯誤
npm run dev                      # 手動端對端 round trip：
#   1. 合成頁：選 key + cert + chain → precheck → confirm warnings → merge → 產出 .pfx
#   2. 抽取頁：選上一步的 .pfx → 抽取 → 產出 private.key + certificates.pem
#   3. 檢視頁：選上一步的 .pfx → 檢視 → 結構化顯示 key/cert/chain 資訊
# 確認 .work/ 操作後為空
# 確認 console/log 無密碼外洩
```

---

## spec.md §6 M1 Todo List 對照表

| spec.md 項目 | 對應 Day |
|-------------|---------|
| Electron + Vue 3 + Vite 初始化 | Day 1 |
| preload + contextBridge | Day 1 |
| ipc-handlers 骨架 | Day 2 |
| services/engines/utils 目錄 | Day 2 |
| i18n 骨架 + 語系檔 | Day 7 |
| .work/ 工作區邏輯 | Day 2 |
| OpenSSL 路徑解析 | Day 2 |
| execFile runner + timeout | Day 3 |
| 輸入驗證 | Day 2 |
| 暫存檔工具 | Day 2 |
| PEM/DER 讀取 + 轉換 | Day 3 |
| OpenSSL 錯誤 parser | Day 3 |
| key↔cert 匹配檢查 | Day 3 |
| chain 解析 + 去重 + 過濾 | Day 4 |
| chain 重排 | Day 4 |
| anchor/unlinked/extra/dup warnings | Day 4 |
| precheck IPC + token | Day 5 |
| merge IPC + token 驗證 | Day 5 |
| 合成 OpenSSL 指令 | Day 5 |
| 合成頁 UI | Day 8 |
| 合成成功 → 轉 JKS 入口 | Day 8 |
| legacy auto/on/off 參數流 | Day 6 |
| auto legacy 判定 + UNCERTAIN | Day 6 |
| 抽取私鑰 .key | Day 6 |
| 抽取伺服器 + CA 憑證 | Day 6 |
| 合併模式 .pem | Day 6 |
| 拆分模式 .crt | Day 6 |
| 抽取頁 UI | Day 9 |
| 抽取結果呈現 | Day 9 |
| view OpenSSL 指令 | Day 6 |
| key info parser | Day 3 |
| cert 欄位 parser | Day 3 |
| SAN/SKI/fingerprint parser | Day 3 |
| chain certs parser | Day 3/6 |
| 檢視頁 UI | Day 9 |
| OperationResult/Warning 映射 | Day 7 |
| 錯誤 → 中文對照表 | Day 7 |
| .work/ 清理驗證 | Day 10 |
| 密碼不落地驗證 | Day 10 |
| Renderer 安全驗證 | Day 1/10 |
| smoke tests（8 組）| Day 10 |
