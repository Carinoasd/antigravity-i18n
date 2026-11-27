# 貢獻指南

感謝你願意協助改善 Antigravity 的中文化！本文件說明詞庫格式、翻譯用語規範與 PR 檢查清單。

## 開發環境

```bash
git clone https://github.com/Carinoasd/antigravity-i18n.git
cd antigravity-i18n
npm install
npm run typecheck
npm run build
npm test
node dist/cli.js validate
```

需要 Node.js 20 以上。

## 詞庫結構

```
locales/
├── protected-terms.json      # 保護詞白名單（不可翻譯的詞）
├── zh-TW/                    # 繁體中文（台灣）
│   ├── sidebar.json          # 側邊欄、Agent 管理員、工作區
│   ├── settings.json         # 設定頁、模型、規則、工作流程
│   ├── permissions.json      # 權限、核准對話框、終端機執行政策
│   ├── chat.json             # 對話面板、Artifacts、審查變更
│   ├── ide.json              # 編輯器選單、終端機、Git、Agent 面板
│   ├── cli.json              # agy 命令列工具
│   └── menu.json             # Electron 原生選單、系統匣、更新提示、載入畫面
└── zh-CN/                    # 簡體中文（同樣 7 個模組）
```

每個 JSON 都是扁平物件：**key 是英文原文（必須與 Antigravity 介面上的字串完全一致，含大小寫與標點）**，value 是譯文。

```json
{
  "Accept All": "全部接受",
  "{count} files changed": "已變更 {count} 個檔案"
}
```

不同模組可以有相同的 key（例如 `menu.json` 與 `ide.json` 都有 `Edit`），但**譯文必須一致**，否則 `validate` 會報錯。

`app` 目標使用 `sidebar`、`settings`、`permissions`、`chat`、`menu` 五個模組；這些詞條同時用於靜態層與執行期注入層。

### 新增字串

1. **同時**在 `zh-TW/` 與 `zh-CN/` 的同一個模組新增相同的 key。
2. 確認英文原文確實出現在 Antigravity 介面中（建議附上截圖或所在畫面）。
3. 執行 `node dist/cli.js validate`，確認沒有錯誤。
4. 可用 `antigravity-i18n apply --lang zh-TW --dry-run` 觀察命中數是否增加。

### 替換規則（為什麼有些字串沒被翻譯？）

為了避免破壞程式邏輯，翻譯引擎只替換**完整的字串常值**，並且：

- **長字串**（含空白且長度 ≥ 8，例如 `"Accept All"`）在任何位置都會替換。
- **短字串**（例如 `"Run"`、`"Off"`）只在 UI 語境替換，例如 `label:`、`title:`、`children:`、`placeholder=`、`localize(key, "...")`。
  因為 `"Off"` 很可能同時是設定值或列舉值，盲目替換會讓功能壞掉。
- `nls.messages.json`、`*.nls.json` 內全部都是顯示文字，會完整替換。
- 不會修改 `node_modules/`、`package.json` 與 asar 的 unpacked 檔案。

### 執行期注入層的比對方式

執行期注入層在畫面上做**完全相符**比對（去除前後空白、合併連續空白），因此 key 必須是畫面上「一個文字節點」的完整內容。若介面把一段文字拆成多個元素（例如 `<b>3</b> files`），請以實際的單一節點文字為 key。含 `{name}`、`%s`、`%d` 的 key 會自動轉成樣式比對。

## 翻譯用語規範

### 繁體中文（zh-TW）—— 台灣慣用語

| 英文 | ✅ 使用 | ❌ 避免 |
| --- | --- | --- |
| Project | 專案 | 項目 |
| Settings | 設定 | 設置 |
| Terminal | 終端機 | 終端 |
| Permissions | 權限 | 許可權 |
| Workspace | 工作區 | 工作空間 |
| Extensions | 擴充功能 | 擴展、插件 |
| Command Palette | 命令選擇區 | 命令面板 |
| File / Folder | 檔案／資料夾 | 文件／文件夾 |
| Default | 預設 | 默認 |
| Message | 訊息 | 信息、消息 |
| Server | 伺服器 | 服務器 |
| Sign In | 登入 | 登錄 |
| Search | 搜尋 | 搜索 |

### 簡體中文（zh-CN）—— 中國大陸慣用語

| 英文 | ✅ 使用 | ❌ 避免 |
| --- | --- | --- |
| Project | 项目 | 专案 |
| Settings | 设置 | 设定 |
| Terminal | 终端 | 终端机 |
| Permissions | 权限 | — |
| Workspace | 工作区 | — |
| Extensions | 扩展 | 扩充功能 |
| Command Palette | 命令面板 | 命令选择区 |
| File / Folder | 文件／文件夹 | 档案／资料夹 |
| Default | 默认 | 预设 |
| Message | 消息 | 讯息 |
| Server | 服务器 | 伺服器 |
| Sign In | 登录 | 登入 |
| Search | 搜索 | 搜寻 |

`validate` 會自動檢查常見的繁簡混用與跨地區用語（規則定義在 `src/core/locales.ts` 的 `TERMINOLOGY_RULES`）。

### 通用原則

- **保護詞不翻譯**：斜線指令（`/plan`、`/swarm`）、MCP、Git、SSH、Diff、Worktree、Agent、產品名稱等，清單見 `locales/protected-terms.json`。若英文原文含有保護詞，譯文必須原樣保留。
- **佔位符必須一致**：`{name}`、`{count}`、`%s`、`%d` 的種類與數量必須與原文相同，位置可依中文語序調整。
- **中英文之間加半形空白**：`開啟 Agent 管理員`、`MCP 伺服器`。
- **標點**：句子使用全形標點（，。？！：）；省略號沿用原文的 `...`，以免影響介面寬度判斷。
- **簡潔**：按鈕與選單文字盡量精簡，避免比原文長太多而截斷。
- **語氣**：zh-TW 對使用者稱「您」，zh-CN 稱「你」。

## PR 檢查清單

送出 PR 前請確認：

- [ ] `npm run typecheck` 通過
- [ ] `npm run build` 通過
- [ ] `npm test` 全部通過
- [ ] `node dist/cli.js validate` 回傳 exit code 0
- [ ] 新增的字串已同時加入 `zh-TW` 與 `zh-CN`，且 key 完全一致
- [ ] 英文 key 與 Antigravity 介面原文完全相同（附上截圖或說明出現位置）
- [ ] 遵守上方用語規範，沒有繁簡混用
- [ ] 佔位符與保護詞皆已原樣保留
- [ ] 修改程式碼時已補上對應的單元測試
- [ ] 修改 `src/runtime/overlay.ts` 時維持函式自足（不引用外部變數或 import），並確認保護區域測試仍通過
- [ ] 若變更 CLI 行為，已同步更新 `README.md`

## 回報問題

開 Issue 時請附上：作業系統、Antigravity 版本、`antigravity-i18n status` 的輸出，以及（若有）錯誤訊息全文。
