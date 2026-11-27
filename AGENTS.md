# AGENTS.md — AI 協作開發規範

本文件是所有 AI 程式助理（Codex、Claude Code、Gemini、Cursor 等）與人類貢獻者共用的開發規範。
`CLAUDE.md` 直接引用本文件；**規範只維護這一份**，請勿在其他檔案複製一套。

## 專案概要

`antigravity-i18n` 是 Google Antigravity 的多語系（`zh-TW` / `zh-CN` / `ja` / `ko`）在地化與背景自訂 CLI。
它會**修改使用者電腦上的應用程式檔案**，因此安全性與可還原性優先於一切。

| 目標 | 機制 |
| --- | --- |
| `app` | `app.asar` 雙層機制：靜態層（主行程選單／系統匣／更新提示）＋執行期 DOM 注入層；`--lang none` 為僅背景模式（不翻譯，只掛載背景與 `Ctrl+Alt+B` 面板） |
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

`npm test` 也會打包 esbuild bundle 並跑完整冒煙測試（`tests/sea.test.ts`）。修改打包流程、`src/runtime/` 或 CLI 入口時，另外執行一次真正的單檔打包：

```bash
npm run build:sea
npm run smoke:sea -- dist-sea/antigravity-i18n-<平台>-<架構>
```

- 不可用 `| tail`、`| head` 等管線包住後再看 exit code：管線會吞掉失敗。
- 測試失敗時回報實際輸出，不可略過或改測試去遷就錯誤行為。
- 修改 CLI 行為時，另外手動執行一次 `node dist/cli.js --help` 與相關指令確認輸出。

## 程式碼規範

- **TypeScript strict + ESM**（`"type": "module"`）。相對 import 一律寫 `.js` 副檔名。
- Node.js ≥ 20：不可使用只有 Node 22 才有的 API，新相依套件也必須支援 Node 20。
- **新增執行期相依套件前先討論**；目前只有 `commander`、`picocolors`、`@electron/asar`。
- `apply --lang none`（`ApplyLang`）：只適用於 app。不做靜態翻譯、不寫入翻譯 runtime，掛鉤以 `{ translate: false }` 產生；manifest 記錄 `lang: "none"`、`runtime.translation: false`。
- 模組邊界：
  - `src/config/paths.ts`：只負責路徑偵測，候選路徑函式保持純函式（以 `PathEnv` 注入平台資訊）。
  - `src/core/asar.ts`：asar 操作一律經過 `AsarArchiver` 介面，方便注入假實作測試。
  - `src/core/translator.ts`：靜態替換引擎，只替換完整字串常值；短字串只在 UI 語境替換。
  - `src/core/runtime.ts`：產生 runtime 腳本與主行程掛鉤（含背景圖載入）。掛鉤行為改變時遞增 `HOOK_VERSION`。
  - `src/core/background.ts`：背景圖設定檔的驗證、讀寫、WSL 路徑轉換與鏡像。
  - `src/core/presets.ts`：內建純 CSS 漸層預設的**唯一來源**；`apply` 時以 JSON 內嵌進掛鉤。
    預設只能用漸層與顏色值（字元限制 `[A-Za-z0-9#%.,()\s-]`，不可有 `url()`）。新增或修改預設後，使用者需重新 `apply --force` 才會更新掛鉤內的表。
  - `src/runtime/overlay.ts`：注入 renderer 的 DOM 翻譯 runtime。
  - `src/runtime/background.ts`：背景圖的主行程讀取函式與 renderer 注入函式。
  - `src/runtime/panel.ts`：介面內背景設定面板（`Ctrl + Alt + B` / macOS `Cmd + Option + B`）。
    掛鉤組合腳本時把 `applyBackground` 以參數傳入（不可直接引用）；設定存於 IndexedDB `antigravity-i18n`。
    「掃描未翻譯英文」的保護區清單（`PROTECTED`）必須與 `overlay.ts` 逐字相同（測試會比對），且絕不讀取表單欄位內容。
  - `src/core/launcher.ts`：智慧啟動器（`launch`）。**不可**加入任何常駐監控或 daemon：只在啟動當下檢查一次。
    啟動指令以純函式 `launchCommandFor` 產生、`spawn` 可注入；`FileLockError` 只提示並略過重新套用，不可中斷啟動。
    雜湊快取存於工具資料目錄的 `launch-state.json`（只影響速度，損毀時重新計算）。
  - `src/core/shortcut.ts`：跨平台桌面捷徑（`shortcut`）。PowerShell 腳本必須是固定字串（`-EncodedCommand`），
    使用者提供的路徑、名稱與參數**一律透過環境變數**傳入（WSL 另外列進 `WSLENV`），不可拼接進 PowerShell 程式碼；
    `.command` / `.desktop` 的參數分別以 POSIX 與 freedesktop 規則加引號，並拒絕換行與控制字元。
    捷徑帶有標記，移除與覆蓋時只處理本工具建立的檔案（除非 `--force`）。測試一律注入暫存目錄與假的 runner / spawn。
- **`src/runtime/` 的特殊規則**：這裡的函式會被 `toString()` 序列化，內嵌進主行程掛鉤或注入頁面，因此
  - 必須完全自足：不可引用模組層級變數、import 或其他函式
  - 零依賴，只用瀏覽器內建 API
  - 不可使用會產生 helper 的 TS 語法（enum、decorator、參數屬性）
  - 不可移除或縮減保護區域（`<code>`、`<pre>`、`.monaco-editor`、`.xterm`、`[contenteditable]`、表單欄位內容、Markdown 正文）
  - 任何錯誤只能 `console.warn`，**絕不可拋出**：掛鉤出錯不得影響 App 啟動，背景圖出錯不得影響翻譯
  - 背景圖層必須維持 `pointer-events: none` 與 `data-antigravity-i18n-skip`
  - 同一條驗證規則（例如 tint 的 `TINT_RE`）在 `src/core/` 與 `src/runtime/` 各有一份時，必須完全一致，並以測試逐一比對同一批輸入
  - `background.json` 必須向下相容：沒有 `kind` 欄位的舊設定一律視為圖片
  - 介面面板：根元素與小按鈕必須帶 `data-antigravity-i18n-skip`；IndexedDB 任何失敗都只能降級為「只在目前視窗生效」並提示；從 IndexedDB 讀回的資料必須重新驗證後才能套用
  - 跨函式共用的字串（例如翻譯停用旗標 `antigravity-i18n:i18n-disabled`）因無法共用常數，需在測試中比對各份內容相同
- `src/core/errors.ts`：`EBUSY` / `EPERM` / `EACCES` 一律轉成帶處理步驟的 `FileLockError`（`atomicWrite` / `atomicCopy` 已處理），CLI 以 `formatFsError` 輸出、控制台顯示步驟與重試按鈕。
- `src/ui/`：本機圖形控制台（`antigravity-i18n` 不帶參數或 `antigravity-i18n ui`）。**只能使用 Node 內建模組**（`node:http`、`node:crypto`），不可新增執行期相依套件。
  - `server.ts`：只監聽 `127.0.0.1`；**所有**請求檢查 `Host` 必須是 `127.0.0.1:<port>`（含首頁，防 DNS rebinding）；**所有** `/api/*` 必須帶正確的 `X-AGI18N-Token`（timingSafeEqual）；有 `Origin` 時必須同源；不回應任何 CORS header。放寬任何一項都不可接受。
  - `actions.ts`：把 CLI 功能包成回傳結構化結果的函式（不印出），偵測函式可注入。
  - `html.ts`：單一自足 HTML，腳本帶 CSP nonce；動態資料一律以 `textContent` 寫入，不可用 `innerHTML`。介面文字放在 `UI_TEXT`（zh-TW / zh-CN / ja / ko / en，五語 key 必須一致），同樣遵守繁簡用語規範。
  - 測試 server 時一律注入只認自訂路徑的 `detect`，並把 `toolHome` / `userHome` 指向暫存目錄。
- **單檔執行檔（Node.js SEA）**：`npm run build:sea`（`scripts/build-sea.mjs`）以 esbuild 打包成 CJS 並用 postject 注入 Node 22 執行檔，產出 `dist-sea/antigravity-i18n-<win|macos|linux>-<arch>[.exe]`；`npm run smoke:sea -- <執行檔>`（`scripts/smoke-sea.mjs`）跑冒煙測試。
  - **不可開啟 esbuild 的 `keepNames`**：它會在函式內插入 `__name()` helper，讓 `src/runtime/` 序列化的注入腳本不再自足。冒煙測試會實際套用假的 app.asar、在模擬的 Electron 與 jsdom 中執行注入腳本，並檢查沒有 esbuild helper。
  - esbuild 可能為避免名稱衝突而改名函式（例如 `isInternalUrl2`）：序列化時一律用 `fn.name`，不可寫死函式名稱。
  - 不可使用頂層 `await`（CJS 打包不支援）；`import.meta.url` 只能出現在一般模式才會執行的路徑。
  - 單檔模式下詞庫與版本來自內嵌資源（`src/core/embedded.ts`，build 時以 `define` 注入 `__AGI18N_EMBEDDED__`），詞庫目錄為虛擬的 `<embedded>/locales`；新增需要讀取套件內檔案的功能時，必須同時支援內嵌模式。
  - 執行期相依套件必須能被 esbuild 打包；只在 Electron 中才存在的模組（`electron`、`original-fs`）列為 external。
  - 不帶參數啟動（例如雙擊執行檔）發生錯誤時，`launchInteractive()` 會印出訊息並等使用者按 Enter，不可移除。
- CLI 的使用者訊息使用繁體中文；程式碼識別字使用英文。

## 安全原則（不可違反）

1. **寫入前一定先備份**：原始檔的 SHA-256、備份路徑都寫進 Manifest，備份寫入後回讀校驗。
2. **`--dry-run` 絕不寫入任何檔案**，包含工具資料目錄 `~/.antigravity-i18n`。
3. **`restore` 必須能 100% 還原**：以位元組比對驗證，測試中要有 `toEqual(原始 Buffer)` 斷言。
4. **重新套用一律以原始檔為來源**（備份或未修改的檔案），不可在已翻譯的內容上再翻譯或再注入。
5. 注入的程式碼必須有明確的開始／結束標記，可偵測、可移除，且出錯時不得影響 App 啟動。
6. 測試只能操作暫存目錄，**不可**讀寫使用者真實的 Antigravity 安裝或家目錄。
   需要工具資料目錄時，設定 `ANTIGRAVITY_I18N_HOME` 指向暫存目錄；
   會觸發 WSL 鏡像的測試，另外設定 `ANTIGRAVITY_I18N_WIN_HOME`（或注入 `wsl` 參數），避免寫入真實的 Windows 家目錄。
7. 使用者提供的值寫進 CSS / JS 前必須驗證（例如背景圖 `--position` 只允許安全字元），主行程讀取時再驗證一次。

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

- 所有支援語系（`zh-TW`、`zh-CN`、`ja`、`ko`）每個模組的 **key 必須完全一致**；新增字串時四邊同時加。
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
src/cli.ts                 commander 入口（不可使用頂層 await）
src/core/embedded.ts       單檔執行檔的內嵌資源（詞庫、版本）
scripts/build-sea.mjs      單檔執行檔打包（esbuild + Node SEA + postject）
scripts/smoke-sea.mjs      單檔執行檔冒煙測試（Release 與 PR CI 共用）
.github/workflows/         ci.yml（PR）、sea.yml（三平台打包，可重用）、release.yml（v* tag 發布）
src/types.ts               共用型別、語系／目標／模組常數
src/config/paths.ts        各平台（含 WSL）安裝路徑偵測
src/core/                  asar / locales / translator / backup / patcher / runtime / background / presets / rules / errors / launcher / shortcut
src/runtime/overlay.ts     renderer 端 DOM 翻譯 runtime
src/runtime/background.ts  背景圖：主行程讀取 + renderer 注入
src/runtime/panel.ts       介面內背景設定面板（Ctrl+Alt+B）
src/commands/              status / apply / restore / rules / bg / launch / shortcut / ui / validate
src/ui/                    本機圖形控制台：server / actions / html（零相依套件）
locales/                   zh-TW、zh-CN 各 7 個模組 + protected-terms.json
tests/                     vitest 單元測試（runtime 測試使用 jsdom，面板持久化測試使用 fake-indexeddb）
```
