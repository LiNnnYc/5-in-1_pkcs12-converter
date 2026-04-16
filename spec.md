# 五合一 PKCS #12 轉檔處理工具 — 技術規格書

> 版本：1.0  
> 日期：2026-04-09

---

## 目錄

1. [功能需求](#1-功能需求)
2. [非功能需求](#2-非功能需求)
3. [技術選型](#3-技術選型)
4. [資料模型](#4-資料模型)
5. [應用程式架構](#5-應用程式架構)
6. [里程碑拆分](#6-里程碑拆分)
7. [已知風險與假設](#7-已知風險與假設)

---

## 1. 功能需求

### 1.1 合成 PKCS #12 檔案

| 項目 | 說明 |
|------|------|
| **描述** | 使用者提供私鑰檔案、憑證檔案（及選填的中繼憑證），合成一個 `.pfx` / `.p12` 檔案 |
| **輸入** | ① 私鑰檔案路徑（PEM/DER 格式）② 憑證檔案路徑（PEM/DER 格式）③ 中繼憑證檔案路徑（選填，可多個；可混用 PEM/DER）④ 匯出密碼 ⑤ 輸出檔案路徑 ⑥ 加密演算法選擇（AES-256-CBC 或 PBE-SHA1-3DES） |
| **輸出** | 一個 PKCS #12 格式檔案（`.pfx` 或 `.p12`） |
| **對應 OpenSSL 指令** | AES-256-CBC：`openssl pkcs12 -export -out output.pfx -inkey key.pem -in cert.pem -certfile chain.pem -passout env:EXPORT_PASSWORD [-passin env:KEY_PASSWORD] -keypbe aes-256-cbc -certpbe aes-256-cbc -macalg sha256`<br>PBE-SHA1-3DES：`openssl pkcs12 -export -out output.pfx -inkey key.pem -in cert.pem -certfile chain.pem -passout env:EXPORT_PASSWORD [-passin env:KEY_PASSWORD] -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES`<br>其中 `chain.pem` 為程式前處理後輸出的單一暫存鏈檔；`EXPORT_PASSWORD` 與 `KEY_PASSWORD` 為透過 `execFile` 的 `env` 選項注入的環境變數，不出現在 process argument list 中（詳見 §2.2 密碼傳遞策略） |
| **加密演算法** | • **AES-256-CBC**（預設）：現代加密標準，安全性較高<br>• **PBE-SHA1-3DES**：傳統格式，供舊系統（如舊版 Windows、Java 8 以前）相容使用 |
| **私鑰前處理** | 若私鑰有密碼保護，透過 OpenSSL 的 `-passin env:KEY_PASSWORD` 參數讓 OpenSSL 在合成時自行解密私鑰，不需事先產生無加密的暫存私鑰檔案。此為強制行為，不提供選項。程式須提示使用者輸入原始私鑰密碼，密碼僅透過環境變數傳入子程序 |
| **中繼憑證前處理** | `chainFiles[]` 可混用 PEM/DER。程式須先解析所有輸入、將 DER 轉為 PEM、移除重複憑證、辨識並忽略無關憑證、依鏈建構演算法重排為正確鏈順序，最後合併為單一暫存 `chain.pem` 供 OpenSSL `-certfile` 使用 |
| **鏈建構演算法** | 憑證鏈的銜接判定優先使用 **Authority Key Identifier（AKI）↔ Subject Key Identifier（SKI）** 配對：子憑證的 AKI 必須等於父憑證的 SKI。若憑證不含 AKI/SKI extension（部分舊憑證），則 fallback 為 **issuer DN ↔ subject DN** 字串比對。無法透過上述任一方式連結到鏈中任何憑證的項目，視為「無關憑證」 |
| **預檢確認流程** | 合成前須先執行 precheck，回傳 `precheckToken`、整理後的憑證鏈與警告清單。正式合成時必須帶回相同的 `precheckToken` 與已確認的 warning code；若輸入檔案已變更或 token 不匹配，必須重新 precheck |
| **precheckToken 機制** | `precheckToken` 為 precheck 時根據所有輸入檔案的「絕對路徑 + 檔案大小（bytes）+ 最後修改時間（mtime, ms）」計算的 SHA-256 hash 值。正式合成時，程式須以相同邏輯重新計算 hash 並與帶入的 token 比對；若不一致（代表檔案在 precheck 後被修改或替換），拒絕執行並要求重新 precheck |
| **憑證鏈檢查** | 合成前須檢查「伺服器憑證 + 使用者提供的中繼憑證」是否可串成有效鏈。此檢查僅要求憑證彼此可銜接，不要求最終根憑證已存在於 trusted store。若中繼憑證順序錯誤但內容足以成鏈，程式須在實際合成前自動重排為正確順序；若提供了 self-signed root，須警告使用者該憑證為 chain anchor，但仍提供「仍要繼續合成」選項，讓使用者可將該 anchor 一併打入 `.pfx` / `.p12`；若 chain 中同時含有可成鏈憑證與無關或重複的憑證，須提示使用者，並在合成時自動忽略無關與重複項目；若最終仍無法成鏈，須以明確警告提示使用者，但提供「仍要繼續合成」選項，讓使用者可強制輸出 `.pfx` / `.p12` |
| **操作串接** | 合成成功後，提供「轉換為 JKS」按鈕，讓使用者可直接將產出的 `.pfx` 檔案轉換為 JKS 格式，免去重新選擇檔案的步驟 |
| **邊界條件** | • 私鑰與憑證不匹配時須明確提示錯誤<br>• 私鑰有密碼保護時須提示輸入私鑰密碼，並於合成前自動解密<br>• 中繼憑證數量為 0～多個<br>• 中繼憑證順序錯誤但仍可成鏈時，合成前須自動調整順序<br>• chain 中若含無關或重複憑證，須提示使用者，並在合成時自動忽略<br>• chain 中若含 self-signed root（anchor），須警告使用者，但允許使用者確認後仍將其打包進輸出檔<br>• 中繼憑證無法與伺服器憑證串成鏈時，須警告使用者，但允許使用者確認後強制繼續合成<br>• 匯出密碼不可為空（需提示使用者）<br>• 輸出路徑不可寫入時須提示錯誤<br>• 輸出檔案若已存在，須先由 UI 完成是否覆寫的確認，再執行合成 |

### 1.2 從 PKCS #12 抽取私鑰與憑證

| 項目 | 說明 |
|------|------|
| **描述** | 從 `.pfx` / `.p12` 檔案中分離出私鑰檔案和憑證檔案 |
| **輸入** | ① PKCS #12 檔案路徑 ② PKCS #12 密碼 ③ 輸出目錄 ④ 憑證輸出格式（合併為單一 PEM 檔案，或拆分為個別 `.crt` 檔案）⑤ Legacy 模式（`auto` / `on` / `off`，預設 `auto`） |
| **輸出** | ① 私鑰檔案（`.key`，PEM 格式，強制無加密）② 伺服器憑證檔案（PEM 格式）③ 中繼/CA 憑證檔案（PEM 格式，若存在） |
| **私鑰輸出** | 私鑰強制以無加密的 PEM 格式匯出（副檔名 `.key`），不提供加密選項 |
| **憑證輸出格式** | 當 PKCS #12 包含多張憑證（伺服器憑證 + 中繼/CA 憑證）時，使用者可選擇：<br>• **合併模式**（預設）：所有憑證匯出至單一 `.pem` 檔案。輸出檔名：私鑰為 `private.key`，合併憑證為 `certificates.pem`<br>• **拆分模式**：每張憑證各自匯出為獨立的 `.crt` 檔案（內容仍為 PEM 格式，強制不使用 DER 格式）。輸出檔名：私鑰為 `private.key`，伺服器憑證為 `server.crt`，中繼/CA 憑證依鏈順序命名為 `ca-1.crt`、`ca-2.crt`… |
| **Legacy 模式** | 預設為 `auto`：程式自動偵測 PKCS #12 檔案的加密演算法。若為 SHA1-3DES 等舊式加密，自動在 OpenSSL 指令中加入 `-legacy` 參數；`on` 表示強制加入 `-legacy`；`off` 表示禁止加入 `-legacy` |
| **Legacy auto 偵測機制** | `auto` 模式的偵測策略為「嘗試 → 重試」：先以不含 `-legacy` 的指令執行一次，若 OpenSSL 回傳特定錯誤（如 `unsupported algorithm`、`PKCS12 routines::pkcs12 pbe crypt error` 等 legacy 相關 error pattern），自動加上 `-legacy` 重試。若首次即成功則不加 `-legacy`。若兩次皆失敗（例如密碼錯誤），則以第一次的錯誤回傳。若首次失敗但錯誤訊息不屬於已知的 legacy error pattern，視為無法自動判定，回傳 `LEGACY_MODE_UNCERTAIN` 警告，請使用者改以 `on` 或 `off` 重新執行 |
| **對應 OpenSSL 指令** | `openssl pkcs12 -in input.pfx -nocerts -noenc -out private.key -passin env:PFX_PASSWORD`<br>`openssl pkcs12 -in input.pfx -clcerts -nokeys -out cert.pem -passin env:PFX_PASSWORD`<br>`openssl pkcs12 -in input.pfx -cacerts -nokeys -out ca.pem -passin env:PFX_PASSWORD`<br>若需 legacy 支援：各指令加入 `-legacy` 參數。注意：OpenSSL 3.x 已將 `-nodes` 更名為 `-noenc`，本專案統一使用 `-noenc` |
| **邊界條件** | • 密碼錯誤須明確提示<br>• 檔案不含私鑰時須提示<br>• 檔案不含中繼憑證時跳過該輸出並告知使用者<br>• 輸出目錄不存在時自動建立或提示<br>• `auto` 模式無法判定是否需要 `-legacy` 時，須提示使用者改以 `on` 或 `off` 重新執行 |

### 1.3 檢視 PKCS #12 檔案資訊

| 項目 | 說明 |
|------|------|
| **描述** | 檢視 PKCS #12 檔案中包含的私鑰與憑證詳細資訊 |
| **輸入** | ① PKCS #12 檔案路徑 ② PKCS #12 密碼 |
| **輸出** | 結構化顯示：① 私鑰資訊（演算法、長度）② 伺服器憑證（主體、發行者、有效期、序號、SAN、**Subject Key Identifier（主體金鑰識別碼）**）③ 中繼/CA 憑證鏈資訊（含各憑證的 Subject Key Identifier） |
| **對應 OpenSSL 指令** | `openssl pkcs12 -in input.pfx -info -nokeys -noenc -passin env:PFX_PASSWORD`（OpenSSL 3.x 統一使用 `-noenc` 取代已棄用的 `-nodes`） |
| **邊界條件** | • 密碼錯誤須明確提示<br>• 解析後的資訊須以易讀的結構化格式呈現，而非 OpenSSL 原始輸出 |

### 1.4 JKS → PKCS #12 轉換

| 項目 | 說明 |
|------|------|
| **描述** | 將 Java KeyStore（`.jks` / `.keystore`）檔案轉換為 PKCS #12 格式 |
| **輸入** | ① JKS 檔案路徑 ② JKS 密碼 ③ 來源 alias 名稱（選填；若有多個 entry 須讓使用者選擇）④ Key 密碼（若與 store 密碼不同）⑤ 輸出 PKCS #12 檔案路徑 ⑥ 輸出密碼 |
| **輸出** | 一個 PKCS #12 格式檔案 |
| **alias 規則** | 若 JKS 內只有一個 `PrivateKeyEntry`，可自動選用該 alias；若有多個 `PrivateKeyEntry`，必須先列出讓使用者選擇；`trustedCertEntry` 不可作為轉換來源。輸出的 PKCS #12 Friendly Name / alias 預設沿用選定的來源 alias |
| **對應 Keytool 指令** | `keytool -importkeystore -noprompt -srckeystore input.jks -srcstoretype JKS -srcstorepass SRC_STORE_PASS -srcalias SOURCE_ALIAS [-srckeypass SRC_KEY_PASS] -destkeystore output.pfx -deststoretype PKCS12 -deststorepass DEST_STORE_PASS -destkeypass DEST_STORE_PASS -destalias SOURCE_ALIAS` |
| **操作串接** | JKS 轉換為 PKCS #12 成功後，提供「抽取私鑰與憑證」按鈕，讓使用者可直接對產出的 `.pfx` 檔案進行抽取操作，免去重新選擇檔案的步驟 |
| **邊界條件** | • JKS 含多個 `PrivateKeyEntry` 時須列出讓使用者選擇<br>• 密碼錯誤須明確提示<br>• alias 不含私鑰（僅 `trustedCertEntry`）時須提示並禁止執行<br>• 所有 Keytool 呼叫須以非互動模式執行，不可在子程序中再提示使用者輸入密碼<br>• 輸出檔案若已存在，須先由 UI 完成是否覆寫的確認，再以非互動模式執行 Keytool |

### 1.5 PKCS #12 → JKS 轉換

| 項目 | 說明 |
|------|------|
| **描述** | 將 PKCS #12 檔案轉換為 Java KeyStore 格式 |
| **輸入** | ① PKCS #12 檔案路徑 ② PKCS #12 密碼 ③ 輸出 JKS 檔案路徑 ④ 輸出 JKS 密碼 |
| **輸出** | 一個 JKS 格式檔案（`.jks` 或 `.keystore`） |
| **alias 規則** | 本功能不提供 alias 輸入。輸出的 JKS alias 固定為 `1`。若來源 PKCS #12 含多個 `PrivateKeyEntry`，視為超出本版範圍，須提示使用者並拒絕執行 |
| **對應 Keytool 指令** | `keytool -importkeystore -noprompt -srckeystore input.pfx -srcstoretype PKCS12 -srcstorepass SRC_STORE_PASS -destkeystore output.jks -deststoretype JKS -deststorepass DEST_STORE_PASS -destkeypass DEST_STORE_PASS -destalias 1` |
| **邊界條件** | • 密碼錯誤須明確提示<br>• 輸出路徑不可寫入時須提示<br>• 目的檔若已存在，須先由 UI 完成是否覆寫檔案的確認，再以非互動模式執行 Keytool<br>• 來源 PKCS #12 若含多個 `PrivateKeyEntry`，須提示不支援並停止 |

---

## 2. 非功能需求

### 2.1 可攜性（Portability）

- 程式為**免安裝**的可攜式應用，整個資料夾即為完整程式
- 不寫入 Windows Registry、AppData 或任何程式資料夾外的位置（使用者指定的輸出路徑除外）
- 不依賴使用者系統上已安裝的任何軟體（OpenSSL、Java 等）
- 若執行流程需要暫存資料夾，只能建立於 `PKCS12_Converter.exe` 同層的 `.work/` 工作區，不可建立於系統暫存目錄、`resources/app/` 內，或程式資料夾外

### 2.2 安全性

- **密碼不落地**：使用者輸入的所有密碼僅存在於記憶體中，不寫入任何暫存檔
- **密碼傳遞策略**：密碼傳入子程序時，依引擎區分處理方式：
  - **OpenSSL**：使用 `-passin env:VAR_NAME` / `-passout env:VAR_NAME` 語法，密碼透過 `child_process.execFile` 的 `env` 選項注入為環境變數。環境變數僅對該子程序可見，不出現在 process argument list 中，避免被其他程序透過 Task Manager 或 `wmic process` 讀取
  - **Keytool**：Keytool 不支援環境變數或 stdin 傳遞密碼，密碼必須以 command-line argument 傳入（`-srcstorepass`、`-deststorepass` 等）。此為 Keytool 的設計限制，程式透過 `execFile`（非 shell）呼叫以降低暴露風險，但密碼仍可能短暫出現於 process argument list 中
- **暫存檔清理**：若操作過程中產生暫存檔，操作完成或失敗後必須立即刪除
- **無網路存取**：程式全程離線運作，不得發出任何網路請求
- **密碼輸入遮罩**：密碼欄位預設遮罩顯示，可切換明文
- **指令注入防護**：不得以 shell 字串拼接 OpenSSL / Keytool 指令。所有外部命令一律使用 `execFile` 與參數陣列呼叫；對輸入只做合法性驗證，不做會改變實際值的 shell escape

### 2.3 效能

- 一般大小的憑證檔案（< 10KB）操作應在 **3 秒內** 完成
- UI 執行命令時須顯示進度指示（spinner / progress），不可凍結介面
- OpenSSL / Keytool 子程序需設定 timeout（建議 30 秒），逾時須終止並提示

### 2.4 可用性

- 介面須有明確的功能分區（Tab 或側邊選單）
- 每個功能頁面提供操作說明提示
- 檔案選擇一律使用系統原生檔案對話框
- 錯誤訊息須以使用者可理解的中文呈現，避免直接顯示原始 stderr

### 2.5 可擴充性

- 預留多語系（i18n）架構，初版僅實作繁體中文
- 前後端分離架構，未來可替換 UI 層或抽換引擎

---

## 3. 技術選型

### 3.1 整體架構

| 層級 | 選型 | 理由 |
|------|------|------|
| **UI 層** | Electron + HTML/CSS/JS | 符合使用者選擇；UI 彈性高，可做出友善引導式介面 |
| **前端框架** | Vue 3 + Vite | 輕量、學習曲線低、單檔元件適合工具型應用 |
| **後端邏輯** | Electron Main Process (Node.js) | 負責呼叫 OpenSSL / Keytool 子程序、檔案 I/O |
| **加密引擎** | 預編譯 OpenSSL（Windows x64） | 隨程式資料夾攜帶，使用者免安裝 |
| **JKS 引擎** | 預編譯 OpenJDK Keytool + 最小 JRE | 僅攜帶 `bin/keytool` 及必要的 JRE runtime |
| **多語系** | vue-i18n | 與 Vue 3 整合良好，支援語系檔熱切換 |
| **打包** | electron-builder | 打包為免安裝的 portable 資料夾結構 |

### 3.2 目錄結構

**原始碼結構（開發中）：**

```
src/
├── main/
│   ├── index.ts
│   ├── ipc-handlers.ts
│   ├── preload.ts
│   ├── engines/
│   │   ├── openssl-runner.ts
│   │   ├── keytool-runner.ts
│   │   └── output-parser.ts
│   ├── services/
│   │   ├── merge-service.ts
│   │   ├── extract-service.ts
│   │   ├── view-service.ts
│   │   └── convert-service.ts
│   └── utils/
│       ├── path-resolver.ts
│       ├── sanitizer.ts
│       └── temp-file.ts
├── renderer/
│   ├── main.ts
│   ├── App.vue
│   ├── components/
│   ├── pages/
│   ├── i18n/
│   └── locales/
│       ├── zh-TW.json
│       └── en.json
└── types/
    └── index.ts
```

**打包後結構：**

```
PKCS12_Converter/
├── PKCS12_Converter.exe          # Electron 主程式
├── .work/                        # 唯一允許的暫存工作區（執行時建立，結束後清理）
├── resources/
│   └── app/                      # 前端打包檔案
├── engines/
│   ├── openssl/
│   │   ├── openssl.exe
│   │   ├── libssl-3-x64.dll
│   │   └── libcrypto-3-x64.dll
│   └── jre-minimal/
│       ├── bin/
│       │   ├── java.exe
│       │   └── keytool.exe
│       └── lib/                  # 最小化 JRE runtime
└── LICENSE
```

### 3.3 預編譯引擎來源建議

| 引擎 | 建議來源 | 說明 |
|------|----------|------|
| OpenSSL | [Shining Light Productions](https://slproweb.com/products/Win32OpenSSL.html) 或 [FireDaemon OpenSSL](https://kb.firedaemon.com/support/solutions/articles/4000121705) | 提供 Windows x64 預編譯版本，可擷取所需 exe + dll |
| Keytool / JRE | [Adoptium (Eclipse Temurin)](https://adoptium.net/) | 使用 `jlink` 裁剪出最小 JRE，僅包含 `java.base` 和 `java.security` 模組 |

---

## 4. 資料模型

本工具為檔案處理工具，不涉及資料庫。以下為主要領域物件：

### 4.1 核心 Entity

```
┌─────────────────────┐
│   OperationRequest   │  每次使用者操作對應一個 Request
├─────────────────────┤
│ type: OperationType  │  (MERGE | EXTRACT | VIEW | JKS_TO_P12 | P12_TO_JKS)
│ inputFiles: File[]   │
│ outputPath: string   │
│ passwords: object    │
│ options: object      │  (含 algorithm, certOutputMode, legacyMode 等)
│ nextAction?: string  │  (操作串接：'convertToJks' | 'extractKeys' 等)
└────────┬────────────┘
         │ 產生
         ▼
┌─────────────────────┐
│  OperationResult     │
├─────────────────────┤
│ success: boolean     │
│ outputFiles: File[]  │
│ message: string      │
│ details: object      │  (VIEW / 預檢結果等)
│ warnings?: OperationWarning[] │  (需顯示給使用者的警告)
│ requiresConfirmation?│  (是否需使用者確認後才能繼續)
└──────────────────────┘
```

### 4.2 憑證資訊模型（VIEW 功能用）

```typescript
interface CertificateInfo {
  subject: string;          // 主體 (CN, O, OU 等)
  issuer: string;           // 發行者
  serialNumber: string;     // 序號
  notBefore: string;        // 有效期起
  notAfter: string;         // 有效期迄
  signatureAlgorithm: string;
  subjectAltNames: string[]; // SAN
  subjectKeyIdentifier: string; // 主體金鑰識別碼 (SKI)
  fingerprint: {
    sha1: string;
    sha256: string;
  };
}

interface PrivateKeyInfo {
  algorithm: string;        // RSA, EC 等
  keySize: number;          // 位元長度
  encrypted: boolean;
}

interface Pkcs12ViewResult {
  privateKey: PrivateKeyInfo | null;
  serverCert: CertificateInfo | null;
  chainCerts: CertificateInfo[];
}
```

### 4.3 警告與預檢模型

```typescript
type WarningCode =
  | 'CHAIN_REORDERED'
  | 'CHAIN_HAS_EXTRA_CERTS'
  | 'CHAIN_HAS_DUPLICATE_CERTS'
  | 'CHAIN_HAS_ANCHOR'
  | 'CHAIN_NOT_LINKED'
  | 'LEGACY_MODE_UNCERTAIN';

interface OperationWarning {
  code: WarningCode;
  message: string;
  requiresConfirmation: boolean;
  details?: Record<string, unknown>;
}

interface MergePrecheckResult {
  precheckToken: string;          // SHA-256 hash，見下方說明
  keyMatchesCert: boolean;
  normalizedChainCerts: CertificateInfo[];
  droppedChainCerts: CertificateInfo[];
  anchorCert: CertificateInfo | null;
}
```

**precheckToken 生成與驗證邏輯：**

`precheckToken` = SHA-256 hex digest of：將所有輸入檔案（keyFile、certFile、chainFiles[]）依固定順序，各取「絕對路徑 + 檔案大小（bytes）+ mtime（ISO 8601 字串）」串接後計算。正式執行合成時，以相同邏輯重新計算並與帶入的 token 比對；不一致則拒絕執行，要求重新 precheck。

---

## 5. 應用程式架構

> 注意：本工具為桌面應用程式，無 Web API 端點。以下描述 Electron 內部 IPC 通道設計。

### 5.1 IPC 通道設計（Renderer ↔ Main Process）

| 通道名稱 | 方向 | 說明 | 參數 | 回傳 |
|----------|------|------|------|------|
| `pkcs12:merge:precheck` | Renderer → Main | 預檢合成輸入、整理鏈順序、產生警告 | `{ keyFile, certFile, chainFiles[], keyFilePassword? }` | `OperationResult<MergePrecheckResult>` |
| `pkcs12:merge` | Renderer → Main | 合成 PKCS #12 | `{ keyFile, certFile, chainFiles[], password, outputPath, algorithm, keyFilePassword?, includeAnchorCert?, precheckToken, confirmedWarningCodes?: WarningCode[] }` | `OperationResult` |
| `pkcs12:extract` | Renderer → Main | 抽取私鑰與憑證 | `{ pfxFile, password, outputDir, certOutputMode, legacyMode }` | `OperationResult` |
| `pkcs12:view` | Renderer → Main | 檢視檔案資訊 | `{ pfxFile, password }` | `OperationResult<Pkcs12ViewResult>` |
| `jks:toP12` | Renderer → Main | JKS → PKCS #12 | `{ jksFile, jksPassword, alias?, keyPassword?, outputPath, outputPassword }` | `OperationResult` |
| `jks:fromP12` | Renderer → Main | PKCS #12 → JKS | `{ pfxFile, pfxPassword, outputPath, jksPassword }` | `OperationResult` |
| `jks:listAliases` | Renderer → Main | 列出 JKS alias | `{ jksFile, jksPassword }` | `{ aliases: { name: string; entryType: 'PrivateKeyEntry' | 'trustedCertEntry' }[] }` |
| `dialog:openFile` | Renderer → Main | 開啟檔案選擇器 | `{ filters, multiSelect }` | `string[]` |
| `dialog:saveFile` | Renderer → Main | 開啟儲存對話框 | `{ filters, defaultName }` | `string` |

### 5.2 Main Process 模組劃分

```
src/main/
├── ipc-handlers.ts         # IPC 路由註冊
├── engines/
│   ├── openssl-runner.ts   # 封裝 OpenSSL CLI 呼叫
│   ├── keytool-runner.ts   # 封裝 Keytool CLI 呼叫
│   └── output-parser.ts    # 解析 OpenSSL / Keytool stdout/stderr
├── services/
│   ├── merge-service.ts    # 合成邏輯
│   ├── extract-service.ts  # 抽取邏輯
│   ├── view-service.ts     # 檢視邏輯
│   └── convert-service.ts  # JKS 互轉邏輯
├── utils/
│   ├── path-resolver.ts    # 解析引擎路徑（相對於 app 目錄）
│   ├── sanitizer.ts        # 輸入過濾與指令跳脫
│   └── temp-file.ts        # 暫存檔管理（僅限 exe 同層 .work/；建立 + 確保清理）
└── preload.ts              # contextBridge 暴露安全 API
```

### 5.3 安全邊界（Context Isolation）

```
┌─────────────────────────────────────────────┐
│  Renderer Process (Vue 3)                    │
│  - 不可直接存取 Node.js API                   │
│  - 不可直接存取 fs、child_process             │
│  - 透過 contextBridge 暴露的 API 與 Main 溝通  │
└──────────────────┬──────────────────────────┘
                   │  IPC (invoke / handle)
┌──────────────────▼──────────────────────────┐
│  Main Process (Node.js)                      │
│  - 執行 OpenSSL / Keytool 子程序              │
│  - 所有檔案 I/O 操作                          │
│  - 輸入驗證與指令組裝                          │
└─────────────────────────────────────────────┘
```

---

## 6. 里程碑拆分

### M1：核心 PKCS #12 操作（合成 + 抽取 + 檢視）

**交付物：**
- Electron 專案基礎架構搭建（含 Vue 3、i18n 骨架）
- OpenSSL 引擎整合（openssl-runner）
- 功能 1.1 合成 PKCS #12
- 功能 1.2 抽取私鑰與憑證
- 功能 1.3 檢視 PKCS #12 資訊
- 錯誤處理與中文訊息
- 暫存檔安全清理機制

**驗收條件：**
- 可成功合成 → 抽取 → 再檢視，完成一輪完整操作
- 密碼錯誤、檔案不匹配等異常情境皆有友善提示
- 合成前可檢查中繼憑證是否成鏈；順序錯誤但可成鏈時會自動重排；無法成鏈時會先警告，使用者確認後仍可完成強制合成
- chain 中若含 self-signed root 會警告使用者為 anchor；chain 中若含無關或重複憑證會提示並於合成時自動忽略
- 抽取功能在 `legacyMode=auto` 無法判定時，會要求使用者以 `on` 或 `off` 重新執行，而不是直接失敗

**M1 詳細 Todo List：**
- 初始化 Electron + Vue 3 + Vite 專案，確認 dev mode 可啟動空白視窗
- 建立 `preload` 與 `contextBridge` 骨架，確保 Renderer 不可直接存取 Node API
- 建立 `src/main/ipc-handlers.ts` 與 IPC 註冊骨架，先接上最小假資料 handler
- 建立 `src/main/services/`、`src/main/engines/`、`src/main/utils/` 目錄與空模組
- 建立繁體中文 i18n 骨架與最小語系檔
- 建立 exe 同層 `.work/` 工作區解析邏輯
- 實作 OpenSSL 引擎路徑解析，能正確找到 bundled binary
- 實作共用 `execFile` runner，統一 timeout、stdout/stderr、exit code 包裝
- 實作共用輸入驗證工具：檔案存在、路徑合法、密碼非空
- 實作 `.work/` 暫存檔工具：建立、追蹤、清理
- 實作 PEM/DER 憑證讀取與 DER 轉 PEM 工具
- 實作 OpenSSL 錯誤 parser 最小版，先支援常見密碼/格式錯誤
- 實作私鑰與伺服器憑證匹配檢查
- 實作 chain 憑證解析、去重、無關憑證過濾
- 實作 chain 重排邏輯，輸出 normalized chain
- 實作 anchor、unlinked chain、extra cert、duplicate cert warnings
- 實作 `pkcs12:merge:precheck` IPC 與 `precheckToken` 回傳
- 實作 `pkcs12:merge`，驗證 `precheckToken` 與 `confirmedWarningCodes`
- 實作合成 `.pfx/.p12` 的 OpenSSL 命令與成功結果回傳
- 實作合成頁 UI：檔案選擇、密碼輸入、precheck 警告確認、執行按鈕
- 實作合成成功後的「轉換為 JKS」入口占位
- 實作抽取功能的 `legacyMode=auto/on/off` 參數流
- 實作 auto legacy 判定流程與 `LEGACY_MODE_UNCERTAIN` 警告
- 實作私鑰抽取為無加密 `.key`
- 實作伺服器憑證與 CA 憑證抽取
- 實作合併模式輸出單一 `.pem`
- 實作拆分模式輸出 `server.crt`、`ca-1.crt`、`ca-2.crt`
- 實作抽取頁 UI：模式切換、legacy 模式選擇、輸出目錄選擇
- 實作抽取完成結果呈現與輸出檔清單
- 實作 `pkcs12:view` OpenSSL 命令封裝
- 實作 private key 基本資訊 parser
- 實作 server cert 欄位 parser：subject、issuer、validity、serial
- 實作 SAN、SKI、SHA1/SHA256 fingerprint parser
- 實作 chain certs 陣列輸出 parser
- 實作檢視頁 UI，結構化呈現 private key / server cert / chain certs
- 實作檢視功能的密碼錯誤與格式錯誤中文訊息
- 建立統一 `OperationResult` / `OperationWarning` 映射邏輯
- 建立 OpenSSL 常見錯誤到中文訊息的對照表
- 驗證所有流程在成功、失敗、取消時都會清理 `.work/`
- 驗證密碼與敏感資料不落地、不寫 log
- 驗證 Renderer 無法直接呼叫 `fs` / `child_process`
- 補一組 merge happy path smoke test
- 補一組 merge warning path smoke test（重排、忽略無關/重複）
- 補一組 merge force path smoke test（anchor、unlinked chain）
- 補一組 extract happy path smoke test
- 補一組 extract legacy path smoke test
- 補一組 view happy path smoke test
- 補一組失敗情境 smoke test（密碼錯誤、檔案不存在、格式錯誤、timeout）
- 補一組 `.work/` 清理 smoke test

---

### M2：JKS 互轉功能

**交付物：**
- Keytool / 最小 JRE 整合
- 功能 1.4 JKS → PKCS #12
- 功能 1.5 PKCS #12 → JKS
- JKS alias 列表與選擇 UI

**驗收條件：**
- 可成功完成 JKS ↔ PKCS #12 雙向轉換
- 多 alias 的 JKS 檔案可正確列出並選擇
- 所有 JKS 轉換皆以非互動模式執行；`PKCS #12 → JKS` 的輸出 alias 固定為 `1`

---

### M3：打磨與打包

**交付物：**
- UI 美化與操作引導優化
- i18n 架構確認（繁體中文語系檔完整）
- electron-builder 打包為 portable 資料夾
- 最終測試（含各種憑證格式、邊界案例）
- 使用者操作手冊（內建於程式中）

**驗收條件：**
- 打包後的資料夾可在乾淨 Windows 10 上直接執行
- 程式資料夾外無殘留檔案
- 五項核心功能全數通過驗收

---

## 7. 已知風險與假設

### 風險

| # | 風險 | 影響 | 緩解措施 |
|---|------|------|----------|
| R1 | **預編譯 OpenSSL 版本相容性** — 不同來源的預編譯版本可能有 DLL 相依問題 | 程式無法啟動或執行失敗 | 在乾淨 VM 上驗證；必要時附帶 VC++ Runtime |
| R2 | **最小化 JRE 體積過大** — 即使用 jlink 裁剪，JRE 仍可能佔 40-80 MB | 整體打包體積偏大 | 評估是否可接受；或考慮僅攜帶 keytool + 必要 jar |
| R3 | **Electron 打包體積** — Electron 本身約 150-200 MB | 整體程式可能超過 250 MB | 若體積不可接受，備案可考慮改用 Tauri（Rust + WebView2） |
| R4 | **OpenSSL 指令注入** — 使用者輸入的檔案路徑或密碼若含特殊字元可能被利用 | 安全漏洞 | 所有輸入經 sanitizer 處理；使用 `execFile`（非 `exec`）避免 shell 解析 |
| R5 | **Windows Defender / 防毒誤報** — 未簽章的 exe 可能被攔截 | 使用者無法執行 | 考慮申請程式碼簽章憑證；提供排除說明文件 |

### 假設

| # | 假設 | 說明 |
|---|------|------|
| A1 | 目標平台為 **Windows 10 / 11 x64** | 不支援 32 位元或其他作業系統 |
| A2 | 使用者具有基本的憑證概念 | 知道什麼是私鑰、憑證、PFX，但不熟 CLI 操作 |
| A3 | 輸入檔案為合法的 PEM / DER / PFX / JKS 格式 | 程式做基本格式驗證，但不處理嚴重損毀的檔案 |
| A4 | OpenSSL 版本使用 3.x 系列 | 指令語法以 OpenSSL 3.x 為準 |
| A5 | 程式以一般使用者權限執行 | 不需要系統管理員權限 |
| A6 | 單一使用者操作 | 不考慮多人同時操作同一份程式的情境 |
