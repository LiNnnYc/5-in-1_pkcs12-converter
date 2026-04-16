# AI 交接文件

每次 session 結束時，複製下方範本填寫後附加在本文件底部。

交接內容以 [spec.md](spec.md) 為準；若本次實作有修改規格、路徑、驗收方式，必須在交接中明確寫出。

## 交接範本

```markdown
## Session #___

| 欄位 | 內容 |
|------|------|
| 日期 | YYYY-MM-DD |
| 對應 Day | Day N（M1_TODO.md）|
| 執行者 | Claude Opus / Sonnet / 其他 |
| 總 token 量 | 約 ___K tokens |

### 本次觸及文件 / 模組

- `spec.md`
- `README.md`
- `src/...` 或其他實際修改路徑

### 完成項目

- [x] 項目 1
- [x] 項目 2

### 未完成項目

- [ ] 項目（原因：___）

### 已知問題 / 技術債

- （無 / 描述問題）

### 偏離規格的決策

- （無 / 描述決策及理由，引用 spec.md 對應章節）

### Runtime / 依賴前提

| 項目 | 狀態 |
|------|------|
| `engines/openssl/openssl.exe` | 已備妥 / 缺少 / N/A |
| `engines/jre-minimal/` | 已備妥 / 缺少 / N/A |
| 測試樣本檔（憑證 / PFX / JKS） | 已備妥 / 缺少 / N/A |
| 其他前提 | （無 / 描述） |

### 環境狀態

| 檢查項 | 狀態 |
|--------|------|
| `npm install` | Pass / Fail / N/A（尚未 scaffold） |
| npm run dev | Pass / Fail（描述）|
| tsc --noEmit | Pass / Fail |
| npm test | Pass / N 個失敗（列出）|

### 安全 / 清理確認

| 檢查項 | 狀態 |
|--------|------|
| `.work/` 清理 | Pass / Fail / N/A |
| 密碼未寫入檔案 | Pass / Fail / N/A |
| 密碼未出現在 log / console | Pass / Fail / N/A |
| Renderer 無法直接存取 `fs` / `child_process` | Pass / Fail / N/A |

### 下一個 Session 起手式

1. 閱讀本交接文件最後一筆記錄
2. 先確認上一筆記錄中的 Runtime / 依賴前提是否已滿足
3. 閱讀 M1_TODO.md 中下一個 Day 的任務清單
4. 執行 `npm test` 確認現有測試通過
5. 執行 `npm run dev` 確認 app 可啟動
6. 開始下一個 Day 的任務
```

---

<!-- 以下為實際交接記錄，每次 session 結束後附加 -->
