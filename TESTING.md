# 測試策略與目前測試結果

## 目的

本文件定義這個專案在不同階段的測試方式：

- **現階段（spec-first）**：以文件一致性、驗收案例覆蓋、可實作性檢查為主
- **scaffold 建立後**：加入 TypeScript 編譯、單元測試、整合測試、smoke test、手動驗證

權威規格來源為 [spec.md](spec.md)。里程碑拆分與每日工作清單見 [M1_TODO.md](M1_TODO.md)。

## 目前階段：Spec-First 測試

### 2026-04-17 測試範圍

- 檢查 repo 是否仍處於 spec-first 狀態
- 檢查 `spec.md`、`README.md`、`HANDOFF.md`、`M1_TODO.md` 的路徑與敘述是否一致
- 檢查 README 是否正確揭露目前尚未有 scaffold / `package.json`
- 檢查是否已有正式測試策略文件

### 實際執行結果

| 檢查項 | 結果 | 說明 |
|------|------|------|
| `package.json` 是否存在 | Fail（預期內） | repo 尚未建立 scaffold，屬目前階段正常狀態 |
| `src/` 是否存在 | Fail（預期內） | 原始碼尚未開始建立 |
| README 是否標示 spec-first 狀態 | Pass | 已明確說明目前不可直接執行 npm workflow |
| `spec.md` 是否使用 `src/...` 路徑 | Pass | 原始碼結構與模組劃分已改為 `src/main` / `src/renderer` / `src/types` |
| `M1_TODO.md` 是否與 `src/...` 路徑一致 | Pass | 任務路徑與 spec 已對齊 |
| `HANDOFF.md` 是否有 runtime / 安全交接欄位 | Pass | 已補 runtime 前提與 `.work/` / 密碼檢查欄位 |
| 正式測試策略文件是否存在 | Pass | 本文件已建立 |

### 現階段測試結論

- 目前 **不能執行真正的 `npm test` / `npm run dev` / `tsc --noEmit`**，因為 repo 尚未進入 scaffold 階段。
- 現階段的測試重點是：**規格一致性、路徑一致性、驗收項是否被文件覆蓋、未來測試是否可落地**。
- 下一階段開始前，需先建立 `package.json`、`src/` 結構與測試框架，才能切換到程式碼層測試。

## 測試分層策略

### Stage 0：文件與規格測試

適用時機：尚未有可執行程式碼時。

檢查內容：

- `spec.md`、`README.md`、`M1_TODO.md`、`HANDOFF.md` 的功能範圍是否一致
- 路徑、模組命名、IPC 名稱是否一致
- M1 驗收條件是否有對應到 TODO 與後續測試案例
- 非功能需求是否有落到測試或手動驗證項

通過條件：

- 無互相衝突的路徑或命名
- README 不誤導使用者以為目前已可執行
- 測試計畫涵蓋 merge / extract / view 的 happy path 與主要 error path

### Stage 1：基礎工程測試

適用時機：完成 Day 1-2 scaffold 後。

必跑項目：

```bash
npm install
tsc --noEmit
npm test -- sanitizer
npm test -- temp-file
npm run dev
```

驗證重點：

- Electron 視窗可啟動
- `window.electronAPI` 存在
- Renderer 無法直接使用 `fs` / `child_process`
- `.work/` 路徑解析與暫存管理正常

### Stage 2：單元測試

適用時機：Day 3-7 完成各模組後。

建議測試檔分布：

- `src/main/utils/__tests__/sanitizer.test.ts`
- `src/main/utils/__tests__/temp-file.test.ts`
- `src/main/engines/__tests__/output-parser.test.ts`
- `src/main/services/__tests__/chain-builder.test.ts`
- `src/main/services/__tests__/merge-service.test.ts`
- `src/main/services/__tests__/extract-service.test.ts`
- `src/main/services/__tests__/view-service.test.ts`
- `src/main/services/__tests__/error-mapper.test.ts`

通過條件：

- 所有 parser 對固定樣本輸出穩定
- warning code 與錯誤映射可預期
- `.work/` 在成功與失敗路徑都會清空

### Stage 3：整合測試

適用時機：OpenSSL runner、service、IPC handler 接線後。

驗證重點：

- IPC 參數可以正確流到 service
- service 可以正確呼叫 OpenSSL runner
- OpenSSL stderr 能轉成 `OperationResult` / i18n key
- dialog handler 可正確回傳選檔結果

建議分法：

- runner / parser 可先用 fixture + mock 驗證
- 真正與 `openssl.exe` 的互動再補 integration test

### Stage 4：Smoke Test

適用時機：Day 10 整合完成後。

建議測試檔：

- `tests/smoke/merge.test.ts`
- `tests/smoke/extract.test.ts`
- `tests/smoke/view.test.ts`
- `tests/smoke/error-and-cleanup.test.ts`

必過案例：

- merge happy path
- merge warning path（亂序、重複、無關憑證）
- merge force path（anchor、unlinked chain）
- extract happy path
- extract legacy path
- view happy path
- error path（密碼錯誤、檔案不存在、格式錯誤、timeout）
- `.work/` 清理驗證

### Stage 5：手動驗證

適用時機：每次里程碑結束與 release 前。

手動驗證項：

1. 合成頁能完成 precheck → warning 確認 → merge
2. 抽取頁能切換 `merged` / `split` 與 `legacyMode=auto/on/off`
3. 檢視頁能結構化顯示 key / server cert / chain certs
4. 所有頁面文字都走 i18n，無硬編碼中文
5. 輸出檔存在時，UI 會先做覆寫確認
6. 操作期間有 loading / progress，不凍結介面
7. 操作結束後 `.work/` 為空
8. console / log 中沒有密碼或敏感資料

## 功能測試矩陣

### Merge

| 類型 | 案例 | 預期 |
|------|------|------|
| Happy path | key + cert + 正常 chain | 成功輸出 `.pfx/.p12` |
| 輸入格式 | key/cert/chain 混用 PEM/DER | 先正規化後成功輸出 |
| key mismatch | 私鑰與憑證不匹配 | 阻止執行並顯示友善錯誤 |
| Reorder | chain 順序錯誤但可成鏈 | 自動重排並發 warning |
| Duplicate | chain 含重複 cert | 自動忽略並發 warning |
| Extra cert | chain 含無關 cert | 自動忽略並發 warning |
| Anchor | chain 含 self-signed root | 發 warning，使用者確認後可繼續 |
| Unlinked | chain 無法完整串接 | 發 warning，允許強制繼續 |
| Token stale | precheck 後檔案被改動 | 拒絕 merge，要求重新 precheck |
| Output exists | 輸出檔已存在 | UI 先詢問是否覆寫 |

### Extract

| 類型 | 案例 | 預期 |
|------|------|------|
| Happy path | 一般 `.pfx` | 輸出 `private.key` 與憑證 |
| Merged mode | 多張 cert | 產出 `certificates.pem` |
| Split mode | 多張 cert | 產出 `server.crt` + `ca-N.crt` |
| Legacy auto success | 首次失敗，判定 legacy，重試成功 | 自動加 `-legacy` |
| Legacy uncertain | 首次失敗但非已知 legacy pattern | 回傳 `LEGACY_MODE_UNCERTAIN` |
| No CA certs | 只有 server cert | 跳過 CA 檔並告知 |
| No private key | 不含私鑰 | 回傳友善錯誤 |
| Output dir missing | 輸出目錄不存在 | 自動建立或明確提示 |

### View

| 類型 | 案例 | 預期 |
|------|------|------|
| Happy path | 一般 `.pfx` | 顯示 key / server cert / chain certs |
| No chain | 無中繼憑證 | `chainCerts` 為空陣列 |
| No private key | 無私鑰 | `privateKey` 為 null 或顯示對應提示 |
| Password wrong | 密碼錯誤 | 顯示中文錯誤 |
| Format invalid | 非法或損毀檔案 | 顯示中文錯誤 |

## 測資準備要求

Day 3 前至少準備以下固定測資，避免後面 parser 與 smoke test 無樣本可驗：

- RSA 私鑰 + server cert + 正常 chain
- EC 私鑰 + cert
- PEM 與 DER 格式各一組
- 含亂序 chain 的樣本
- 含重複 cert 的樣本
- 含無關 cert 的樣本
- 含 self-signed root anchor 的樣本
- legacy PKCS#12 樣本（例如 SHA1-3DES）
- 密碼錯誤樣本或對應模擬方式

所有測資必須：

- 不含真實客戶憑證與私鑰
- 可重複使用於 unit / integration / smoke test
- 在交接文件中記錄來源與用途

## Release Gate

進入 M1 驗收前，至少滿足以下條件：

- `npm test` 全綠
- `npm run build` 成功
- merge / extract / view smoke tests 全綠
- `.work/` 清理驗證通過
- 密碼未寫入檔案、log、console
- Renderer 無法直接存取 Node API
- 手動 round-trip 驗證通過一次

## 維護規則

- 每當 `spec.md` 新增功能或邊界條件，本文件必須同步補上對應測試案例
- 每當 `M1_TODO.md` 新增 Day 任務，應補上對應的驗證方式
- 每次 session 若新增測資、調整測試命令或變更 release gate，需同步更新 [HANDOFF.md](HANDOFF.md)
