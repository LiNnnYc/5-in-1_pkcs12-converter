# 五合一 PKCS #12 轉檔處理工具

本專案目標是實作一個 Windows 桌面應用程式，提供 GUI 介面完成 PKCS#12 相關的憑證檔案處理。成品將採免安裝可攜式設計，並自帶 OpenSSL 和最小 JRE/Keytool。

## 目前狀態

目前這個 repository 仍是 spec-first 階段，權威來源是 [spec.md](spec.md)。實作 scaffold 尚未建立；當前工作重點是先把規格、里程碑拆分、交接格式定清楚，再依 `M1_TODO.md` 開始落地。

預計原始碼結構會放在：

- `src/main/`：Electron main process、IPC、engines、services、utils
- `src/renderer/`：Vue UI、頁面、元件、i18n 與 locales
- `src/types/`：共用 TypeScript 型別

## 文件索引

| 檔案 | 說明 |
|------|------|
| [spec.md](spec.md) | 技術規格書（權威來源）|
| [CLAUDE.md](CLAUDE.md) | Claude Code 專案指引 |
| [AGENTS.md](AGENTS.md) | AI Agent 開發指南 |
| [M1_TODO.md](M1_TODO.md) | 里程碑 1 每日工作清單 |
| [TESTING.md](TESTING.md) | 測試策略與目前測試結果 |
| [HANDOFF.md](HANDOFF.md) | AI 交接範本 |
| [PFX轉檔程式企畫書.txt](PFX轉檔程式企畫書.txt) | 原始企劃書 |
| [pkcs12轉檔工具_規格書修改_20260409.txt](pkcs12轉檔工具_規格書修改_20260409.txt) | 規格修訂 |

## 里程碑

- [ ] **M1** — 核心 PKCS#12 操作（合成 + 抽取 + 檢視）+ Electron/Vue scaffold
- [ ] **M2** — JKS ↔ P12 轉換（Keytool/JRE 整合）
- [ ] **M3** — UI 打磨、i18n 完善、electron-builder portable 打包

## 技術選型

Electron + Vue 3 + Vite + TypeScript + vue-i18n + electron-builder

目標平台：Windows 10/11 x64

## 開發指令

以下指令是 **scaffold 建立完成後** 的預期 workflow；目前 repo 尚未有可直接執行的 `package.json`：

```bash
npm install          # 安裝依賴
npm run dev          # 啟動開發模式
npm test             # 執行測試
npm run build        # 建置
npm run package      # 打包為 portable
```
