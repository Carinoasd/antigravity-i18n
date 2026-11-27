# AGENTS.md — AI 協作開發規範

本文件是所有 AI 程式助理（Codex、Claude Code、Gemini、Cursor 等）與人類貢獻者共用的開發規範。
`CLAUDE.md` 直接引用本文件；**規範只維護這一份**，請勿在其他檔案複製一套。

## 專案概要

`antigravity-i18n` 是 Google Antigravity 的繁體中文（`zh-TW`）／簡體中文（`zh-CN`）中文化 CLI。
它會**修改使用者電腦上的應用程式檔案**，因此安全性與可還原性優先於一切。

| 目標 | 機制 |
| --- | --- |
| `app` | `app.asar` 雙層機制：靜態層（主行程選單／系統匣／更新提示）＋執行期 DOM 注入層 |
| `ide` | 修補 `nls.messages.json`、workbench bundle，並同步 `product.json` checksums |
| `cli` | 修補 Node.js 版 `agy` 的 JS bundle |

## 必跑驗證指令

任何變更在宣告完成、commit 或開 PR 前，**以下四個指令都必須通過**（exit code 0）：

```bash
npm run typecheck
npm run build
npm test
node dist/cli.js validate
```

- 不可用 `| tail`、`| head` 等管線包住後再看 exit code：管線會吞掉失敗。
- 測試失敗時回報實際輸出，不可略過或改測試去遷就錯誤行為。
- 修改 CLI 行為時，另外手動執行一次 `node dist/cli.js --help` 與相關指令確認輸出。

## 程式碼規範

- **TypeScript strict + ESM**（`"type": "module"`）。相對 import 一律寫 `.js` 副檔名。
- Node.js ≥ 20：不可使用只有 Node 22 才有的 API，新相依套件也必須支援 Node 20。
- **新增執行期相依套件前先討論**；目前只有 `commander`、`picocolors`、`@electron/asar`。
- 模組邊界：
  - `src/config/paths.ts`：只負責路徑偵測，候選路徑函式保持純函式（以 `PathEnv` 注入平台資訊）。
  - `src/core/asar.ts`：asar 操作一律經過 `AsarArchiver` 介面，方便注入假實作測試。
  - `src/core/translator.ts`：靜態替換引擎，只替換完整字串常值；短字串只在 UI 語境替換。
  - `src/core/runtime.ts`：產生 runtime 腳本與主行程掛鉤。
  - `src/runtime/overlay.ts`：注入 renderer 的 DOM 翻譯 runtime。
- **`src/runtime/overlay.ts` 的特殊規則**：此函式會被 `toString()` 序列化注入頁面，因此
  - 必須完全自足：不可引用模組層級變數、import 或其他函式
  - 零依賴，只用瀏覽器內建 API
  - 不可使用會產生 helper 的 TS 語法（enum、decorator、參數屬性）
  - 不可移除或縮減保護區域（`<code>`、`<pre>`、`.monaco-editor`、`.xterm`、`[contenteditable]`、表單欄位內容、Markdown 正文）
- CLI 的使用者訊息使用繁體中文；程式碼識別字使用英文。

## 安全原則（不可違反）

1. **寫入前一定先備份**：原始檔的 SHA-256、備份路徑都寫進 Manifest，備份寫入後回讀校驗。
2. **`--dry-run` 絕不寫入任何檔案**，包含工具資料目錄 `~/.antigravity-i18n`。
3. **`restore` 必須能 100% 還原**：以位元組比對驗證，測試中要有 `toEqual(原始 Buffer)` 斷言。
4. **重新套用一律以原始檔為來源**（備份或未修改的檔案），不可在已翻譯的內容上再翻譯或再注入。
5. 注入的程式碼必須有明確的開始／結束標記，可偵測、可移除，且出錯時不得影響 App 啟動。
6. 測試只能操作暫存目錄，**不可**讀寫使用者真實的 Antigravity 安裝或家目錄。
   需要工具資料目錄時，設定 `ANTIGRAVITY_I18N_HOME` 指向暫存目錄。

## 詞庫與繁簡用語準則

詳細對照表見 [CONTRIBUTING.md](./CONTRIBUTING.md#翻譯用語規範)。摘要：

| 英文 | zh-TW（台灣） | zh-CN（中國大陸） |
| --- | --- | --- |
| Project | 專案 | 项目 |
| Settings | 設定 | 设置 |
| Terminal | 終端機 | 终端 |
| Extensions | 擴充功能 | 扩展 |
| Command Palette | 命令選擇區 | 命令面板 |
| File / Folder | 檔案／資料夾 | 文件／文件夹 |
| Default | 預設 | 默认 |
| Message | 訊息 | 消息 |
| Server | 伺服器 | 服务器 |

- `zh-TW` 與 `zh-CN` 每個模組的 **key 必須完全一致**；新增字串時兩邊同時加。
- key 是英文原文，必須與介面上的字串**完全相同**（大小寫、標點、省略號）。
- 佔位符（`{name}`、`%s`、`%d`）的種類與數量必須與原文一致。
- 保護詞（`locales/protected-terms.json`：`/plan`、`/swarm`、MCP、Git、SSH、Diff、Worktree、Agent 等）原樣保留。
- 繁體不可混入簡體字，簡體不可混入繁體字；`validate` 會檢查，規則在 `src/core/locales.ts` 的 `TERMINOLOGY_RULES`。
- 跨模組的同名 key 譯文必須一致。
- 不要編造介面字串：新增 key 時說明它出現在哪個畫面。

## 分支與協作原則

- `main` 隨時保持可發佈狀態（CI 全綠）。**不可對 `main` force push。**
- 每項工作開新分支，命名：
  - `feat/<描述>`：新功能
  - `fix/<描述>`：錯誤修正
  - `locale/<描述>`：只改詞庫
  - `docs/<描述>`：只改文件
- **一個分支同一時間只由一個 AI 助理（或一個人）負責**。多個 AI 協作時各自開分支，透過 PR 合併，不要同時改同一個分支。
- 接手別人的分支前先 `git fetch` 並 rebase 到最新，不要覆蓋他人的 commit。
- Commit message 採 Conventional Commits：`feat:`、`fix:`、`docs:`、`test:`、`refactor:`、`chore:`，描述可用中文。
- 一個 commit 只做一件事；詞庫變更與程式碼變更盡量分開 commit。
- 開 PR 前跑完「必跑驗證指令」，並依 [CONTRIBUTING.md 的 PR 檢查清單](./CONTRIBUTING.md#pr-檢查清單) 自我檢查。
- 不要 commit `dist/`、`node_modules/` 或任何含憑證的檔案。

## 目錄速查

```
src/cli.ts                 commander 入口
src/types.ts               共用型別、語系／目標／模組常數
src/config/paths.ts        各平台（含 WSL）安裝路徑偵測
src/core/                  asar / locales / translator / backup / patcher / runtime / rules
src/runtime/overlay.ts     renderer 端 DOM 翻譯 runtime
src/commands/              status / apply / restore / rules / validate
locales/                   zh-TW、zh-CN 各 7 個模組 + protected-terms.json
tests/                     vitest 單元測試（runtime 測試使用 jsdom）
```
