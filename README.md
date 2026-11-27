# antigravity-i18n

跨平台（Linux / macOS / Windows）的 **Google Antigravity 中文化 CLI 工具**，支援 **繁體中文（`zh-TW`）** 與 **簡體中文（`zh-CN`）**。

- 🖥️ 支援 Antigravity **App**（桌面版 2.0+，`app.asar`）、**IDE**（編輯器與 Agent 面板）、**CLI**（`agy`）
- 🔒 套用前自動計算 SHA-256、備份原始檔並寫入 Manifest，可**一鍵無損還原**
- 🧪 `--dry-run` 先預覽命中字串數與覆蓋率，不動任何檔案
- 🪶 **零侵入模式**：只安裝全域規則，讓 AI 全程以中文回覆，完全不修改安裝檔
- ✅ 內建 CI 詞庫驗證器（key 一致性、佔位符、保護詞、繁簡用語檢查）

> ⚠️ 本專案為社群專案，與 Google 無關。修改應用程式檔案有風險，請先用 `--dry-run` 預覽，並確認 `restore` 可正常運作。

## 安裝

需要 Node.js 20 以上。

```bash
git clone https://github.com/<your-account>/antigravity-i18n.git
cd antigravity-i18n
npm install
npm run build
npm link   # 之後即可直接使用 antigravity-i18n 指令
```

不想 `npm link` 的話，也可以直接以 `node dist/cli.js <指令>` 執行。

## 快速開始

```bash
# 1. 檢查本機安裝與中文化狀態
antigravity-i18n status

# 2. 先預覽（不修改任何檔案）
antigravity-i18n apply --lang zh-TW --dry-run

# 3. 關閉 Antigravity 後正式套用
antigravity-i18n apply --lang zh-TW

# 4. 想還原時
antigravity-i18n restore
```

只想讓 AI 用中文回答、不想動任何安裝檔？

```bash
antigravity-i18n rules install --lang zh-TW
```

## 指令說明

### `status`（別名 `doctor`）

掃描本機 `app` / `ide` / `cli` 的安裝路徑、是否已中文化、備份是否完整，以及全域規則狀態。

```bash
antigravity-i18n status
antigravity-i18n doctor --target ide
antigravity-i18n status --target app --path "/Applications/Antigravity.app"
```

狀態說明：

| 狀態 | 意義 |
| --- | --- |
| 已套用 | 所有修補檔案的 SHA-256 與套用後的紀錄一致 |
| 部分失效 | 有檔案在套用後被修改，通常是 **Antigravity 官方更新**，請重新 `apply` |
| 尚未套用 | 沒有套用紀錄 |

### `apply`

```bash
antigravity-i18n apply --lang <zh-TW|zh-CN> [--target <app|ide|cli|all>] [--path <customPath>] [--dry-run] [--force]
```

| 選項 | 說明 |
| --- | --- |
| `-l, --lang` | **必填**，`zh-TW` 或 `zh-CN`（也接受 `zh_tw`、`tw`、`zh-Hant` 等寫法） |
| `-t, --target` | `app`、`ide`、`cli` 或 `all`（預設 `all`，偵測不到的目標會自動略過） |
| `-p, --path` | 手動指定安裝路徑，需搭配單一 `--target` |
| `--dry-run` | 只預覽命中字串數與預計覆蓋率，不修改任何檔案 |
| `-f, --force` | 已套用過時仍強制重新套用（例如切換語系） |

套用流程：

1. 偵測安裝路徑並計算原始檔 SHA-256
2. 將原始檔備份到 `~/.antigravity-i18n/backups/`，並回讀校驗
3. 套用詞庫替換（只替換完整字串常值，詳見[替換規則](#替換規則)）
4. IDE：同步更新 `product.json` 的 `checksums`，避免「安裝似乎已損毀」提示
5. macOS App：同步更新 `Info.plist` 的 `ElectronAsarIntegrity`
6. 寫入 Manifest 到 `~/.antigravity-i18n/manifests/` 並輸出摘要

安全機制：

- **偵測到已套用時預設拒絕重複覆蓋**，需加上 `--force`。`--force` 會以**備份的原始檔**重新翻譯，不會發生重複翻譯。
- 若 **官方版本更新導致 hash 改變**，會顯示警告，並以新版檔案作為新的原始檔重新備份。
- 寫入途中發生錯誤時，會自動以備份回滾已寫入的檔案。

範例：

```bash
# 只中文化 IDE
antigravity-i18n apply --lang zh-TW --target ide

# 由繁體切換為簡體
antigravity-i18n apply --lang zh-CN --force

# Windows 自訂安裝路徑
antigravity-i18n apply --lang zh-TW --target app --path "D:\Apps\Antigravity"

# Linux 自訂安裝路徑
antigravity-i18n apply --lang zh-CN --target ide --path /opt/antigravity
```

### `restore`

校驗備份檔 SHA-256 後一鍵無損還原。還原依據 Manifest 進行，即使目前偵測不到安裝也能還原。

```bash
antigravity-i18n restore
antigravity-i18n restore --target ide
antigravity-i18n restore --target app --path "/Applications/Antigravity.app"
```

- 備份檔遺失或 SHA-256 不符時拒絕還原（不會寫入任何檔案）。
- 若檔案在中文化後又被修改（例如官方更新），預設中止以免用舊版覆蓋新版；確定要還原請加上 `--force`。
- 還原完成後會刪除該次的 Manifest 與備份。

### `rules`

零侵入模式：管理 `~/.gemini/config/rules/language-zh-tw.md`（或 `language-zh-cn.md`），內含 `trigger: always_on` 的 YAML frontmatter，讓 AI 全程以中文回覆，並在說明介面時附註英文按鈕名稱（例如「設定（Settings）」），方便對照尚未中文化的介面。

```bash
antigravity-i18n rules install --lang zh-TW
antigravity-i18n rules status
antigravity-i18n rules remove              # 移除全部由本工具建立的規則
antigravity-i18n rules remove --lang zh-CN
antigravity-i18n rules install --lang zh-CN --home /path/to/home
```

產生的檔案開頭如下：

```markdown
---
trigger: always_on
description: "一律使用繁體中文（台灣）回覆，並在說明介面操作時附註英文按鈕名稱"
---
<!-- managed-by: antigravity-i18n -->
```

- 安裝某一語系時，會自動移除另一語系由本工具建立的規則，避免衝突。
- 不會覆蓋或刪除你自己建立的同名規則檔（除非加上 `--force`）。

### `validate`

CI 用詞庫驗證器，通過回傳 exit code `0`，失敗回傳 `1`。

```bash
antigravity-i18n validate
antigravity-i18n validate --dir ./locales
```

檢查項目：

- JSON 語法正確、根節點為物件、值皆為字串
- 模組不可為空、key 與譯文不可為空字串
- `zh-TW` 與 `zh-CN` 每個模組的 key 完全一致
- 佔位符（`{name}`、`%s`、`%d`）與原文一致
- 保護詞白名單（`locales/protected-terms.json`）未被誤改
- 繁簡混用與跨地區用語（例如 zh-TW 出現「命令面板」、zh-CN 出現「终端机」）
- 跨模組重複的 key 譯文必須一致

## 支援目標與預設偵測路徑

| 目標 | 說明 | macOS | Windows | Linux |
| --- | --- | --- | --- | --- |
| `app` | 桌面版（`app.asar`） | `/Applications/Antigravity App.app`、`/Applications/Antigravity.app` | `%LOCALAPPDATA%\Programs\Antigravity App`、`%ProgramFiles%\Antigravity` | `/opt/Antigravity`、`/usr/share/antigravity`、`~/.local/share/antigravity` |
| `ide` | 編輯器（`resources/app/out`） | `/Applications/Antigravity.app` | `%LOCALAPPDATA%\Programs\Antigravity` | `/usr/share/antigravity`、`/opt/antigravity` |
| `cli` | `agy` | `PATH`、`~/.local/bin`、`/opt/homebrew/bin` | `PATH`、`%APPDATA%\npm` | `PATH`、`~/.antigravity/cli/bin`、`/usr/local/bin` |

> 預設路徑為依常見安裝方式推測的候選位置。若你的安裝位置不同，請用 `--path` 指定；也歡迎發 PR 補充偵測路徑（`src/config/paths.ts`）。
>
> `cli` 目標目前只支援 Node.js 版的 `agy`（JS bundle）。若 `agy` 是原生二進位執行檔，`status` 會顯示「不支援」，此時建議使用 `rules` 零侵入模式。

### IDE 會修補哪些檔案

- `out/nls.messages.json`（VS Code 系列的介面字串表）
- `out/vs/workbench/workbench.desktop.main.js`
- 名稱含 `antigravity` / `agent` 的內建擴充功能：`package.nls.json` 與 `dist/`、`out/`、`webview/` 內的 JS / HTML
- `product.json` 的 `checksums`（僅同步雜湊，不改其他內容）

## 替換規則

Electron / VS Code 的 bundle 裡，`"Off"`、`"Run"` 這類短字串常常同時被當成設定值或列舉值，盲目全域取代會讓功能壞掉。因此翻譯引擎：

- 只替換**完整的字串常值**（`"..."`、`'...'`、`` `...` ``），不會替換部分相符的字串
- **長字串**（含空白且長度 ≥ 8）在任何位置都會替換
- **短字串**只在 UI 語境替換：`label:`、`title:`、`tooltip:`、`placeholder:`、`children:`、`localize(key, "...")`、`createElement(tag, props, "...")` 等
- JSON 只替換「值」、不動 key；`nls.messages.json` 與 `*.nls.json` 全部替換
- HTML 替換文字節點與 `title` / `placeholder` / `aria-label` / `alt` 屬性
- 不修改 `node_modules/`、`package.json`，以及 asar 的 unpacked 原生模組

因此 `--dry-run` 顯示的覆蓋率是「詞庫中有多少條在這個版本的檔案裡被找到」，會隨 Antigravity 版本而變化。

## 各平台注意事項

- **請先完全關閉 Antigravity** 再執行 `apply` / `restore`。Windows 上檔案被占用時會出現 `EBUSY` / `EPERM`。
- **權限**：安裝在系統目錄（如 `/opt`、`/usr/share`、`C:\Program Files`）時需要 `sudo` 或系統管理員權限。使用 `sudo` 時，資料會寫到 root 的家目錄；可用 `sudo -E` 或設定 `ANTIGRAVITY_I18N_HOME` 指定資料目錄。
- **macOS**：修改 App 內容會使程式碼簽章失效，套用後請執行：
  ```bash
  codesign --force --deep --sign - "/Applications/Antigravity.app"
  ```
- **官方更新**：Antigravity 更新後會覆蓋中文化內容。`status` 會顯示「部分失效」，重新執行 `apply` 即可。

## 資料目錄

```
~/.antigravity-i18n/          # 可用環境變數 ANTIGRAVITY_I18N_HOME 覆寫
├── manifests/
│   └── ide-1a2b3c4d5e6f.json # 每個安裝路徑一份
└── backups/
    └── ide-1a2b3c4d5e6f/
        └── 2026-01-01T00-00-00-000Z/
            ├── 000-nls.messages.json
            └── 001-workbench.desktop.main.js
```

Manifest 範例：

```json
{
  "schemaVersion": 1,
  "tool": "antigravity-i18n",
  "target": "ide",
  "lang": "zh-TW",
  "installRoot": "/usr/share/antigravity",
  "files": [
    {
      "path": "/usr/share/antigravity/resources/app/out/nls.messages.json",
      "role": "content",
      "originalSha256": "…",
      "patchedSha256": "…",
      "backupPath": "~/.antigravity-i18n/backups/ide-…/000-nls.messages.json",
      "hits": 128
    }
  ],
  "stats": { "totalKeys": 192, "matchedKeys": 150, "totalHits": 410, "coverage": 0.78 }
}
```

## 專案結構

```
src/
├── cli.ts                 # commander 入口（編譯為 dist/cli.js）
├── types.ts
├── config/paths.ts        # 各平台安裝路徑偵測
├── core/
│   ├── asar.ts            # app.asar 抽象層（可注入假實作做單元測試）
│   ├── locales.ts         # 詞庫載入與驗證
│   ├── translator.ts      # 替換引擎
│   ├── backup.ts          # SHA-256、備份、Manifest
│   ├── patcher.ts         # 套用 / 狀態 / 還原
│   └── rules.ts           # 全域規則
└── commands/              # status / apply / restore / rules / validate
locales/                   # 詞庫（zh-TW、zh-CN 各 6 個模組）
tests/                     # vitest 單元測試
```

## 開發

```bash
npm install
npm run typecheck
npm run build
npm test
node dist/cli.js validate
```

詞庫格式、用語規範與 PR 檢查清單請見 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 授權

[MIT](./LICENSE)
