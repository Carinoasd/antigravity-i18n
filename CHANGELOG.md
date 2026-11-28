# 更新紀錄 / Changelog

本專案的重大變更都會記錄在這裡。格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

> All notable changes to this project are documented here (in Traditional Chinese).
> The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

<!--
  版本標題的比較連結（例如 [0.2.0]: https://github.com/Carinoasd/antigravity-i18n/compare/v0.1.0...v0.2.0）
  請在對應的 v* tag 推送後再補上，避免連到尚不存在的 tag。
-->

## [Unreleased]

## [0.2.0] - 2026-11-28

第一個正式發佈版本：推送 `v0.2.0` tag 後，GitHub Actions 會在三平台打包單檔執行檔，並建立附有 `SHA256SUMS.txt` 的 Release。

> **升級提醒**：App 的主行程掛鉤從 v4 升級為 **v6**。升級本工具後請執行一次
> `antigravity-i18n apply --target app --lang <語系> --force`；或直接透過 `antigravity-i18n launch`（桌面捷徑）
> 開啟 Antigravity，偵測到舊版掛鉤時會自動重新套用。

### 新增

- **智慧啟動器 `launch`**（[#8](https://github.com/Carinoasd/antigravity-i18n/pull/8)）：開啟 Antigravity 的當下比對 `app.asar` 的 SHA-256，
  偵測到官方自動更新覆蓋了在地化、或掛鉤為舊版時，先備份新版原始檔再自動重新套用，接著啟動 Antigravity 並立即結束。
  **不常駐任何背景程式（0 MB 記憶體）**；雜湊以檔案大小與修改時間快取，未變更時毫秒級跳過。
  Antigravity 執行中導致檔案被鎖定時，只提示並略過本次重新套用，不影響啟動。
- **桌面捷徑 `shortcut install | remove | status`**（#8）：Windows `.lnk`（Antigravity 圖示、最小化執行）、
  WSL（在 Windows 桌面建立 `.lnk`，透過 `wsl.exe` 執行）、macOS `.command`、Linux `.desktop`。
  PowerShell 腳本為固定字串，路徑與參數一律透過環境變數傳入，防止字串注入；只覆蓋或移除本工具建立的捷徑。
  圖形控制台新增「桌面捷徑」區塊與對應的 API。
- **`Ctrl + Alt + B` 面板：掃描本頁未翻譯英文**（#8）：列出畫面上仍是英文、詞庫沒有對應的介面字串
  （跳過程式碼、編輯器、終端機、Markdown 正文與表單內容），可一鍵複製成 `{ "Original Text": "" }` JSON，或前往 GitHub 回報。
- **桌布收藏夾與自動輪播**（[#9](https://github.com/Carinoasd/antigravity-i18n/pull/9)）：把目前的背景圖加入收藏、點縮圖一鍵切換；
  單張 ≤ 10 MB、最多 12 張、總容量 ≤ 30 MB 的低記憶體硬上限；輪播可選關閉／每次開啟視窗／每 15、30、60 分鐘。
- **外觀微調**（#9）：CJK 介面字型最佳化（不影響程式碼等寬字型）與毛玻璃卡片模式，預設關閉、開關立即生效。
- **五語免重整即時切換**（#9）：面板內切換繁體中文／简体中文／日本語／한국어／English 原文，不必重新整理頁面。
  四語詞庫以共享 key 的精簡格式一起打包進 runtime（約為四份獨立詞庫的一半大小）。
- **詞庫**：補齊 Antigravity v2.36.0 首頁的 7 條高頻字串（`Workspace`、`No Project`、首頁輸入框與建議卡片等），四語各 632 條（#8）。
- **文件**：新增日文 [`README.ja.md`](./README.ja.md) 與韓文 [`README.ko.md`](./README.ko.md)，五份 README 頂部加上五語導覽列，
  並預留「實機展示」截圖區塊（檔名約定見 [`docs/images/README.md`](./docs/images/README.md)）。
- 新增 `.github/FUNDING.yml` 贊助設定範本（預設全部註解，不會顯示 Sponsor 按鈕）與本更新紀錄。

### 變更

- 主行程掛鉤 `HOOK_VERSION` 4 → 6：v5 加上未翻譯掃描，v6 加上桌布收藏夾、外觀微調與五語切換。
- 面板原本的「中文介面」勾選框改為五語選單；偏好改存於 `localStorage` 的 `antigravity-i18n:lang`，
  舊的 `antigravity-i18n:i18n-disabled` 旗標仍然有效。以其他語系重新 `apply` 後，舊的介面語言選擇不再生效。
- 面板的 IndexedDB `antigravity-i18n` 升級為版本 2（新增 `gallery` store，既有的 `settings` 完整保留）。
- `apply`、圖形控制台與 `launch` 會把四語詞庫一併打包進 App 的翻譯 runtime；靜態層（原生選單、系統匣）仍只使用 `apply` 指定的語系，
  `--lang none` 仍不寫入翻譯 runtime。
- 翻譯 runtime 的 `stop()` 現在會同時把已翻譯的文字還原成英文原文。
- 文件：修正 README 中 `apply --lang` 與 `rules` 只列出繁簡中文的說明（實際支援 `zh-TW`、`zh-CN`、`ja`、`ko`）。

## [0.1.0] - 2026-11-28

開發期間的初始版本（未建立 tag 與 Release）。

### 新增

- **CLI**：`status`（別名 `doctor`）、`apply`、`restore`、`rules`、`validate`，支援 Antigravity **App**（`app.asar`）、
  **IDE**（VS Code 系列結構）與 **CLI**（Node.js 版 `agy`）三個目標，以及 Linux / macOS / Windows / WSL 的安裝路徑偵測
  （WSL 會一併偵測裝在 Windows 側的 Antigravity）。
- **安全備份與無損還原**：寫入前計算 SHA-256、備份原始檔並回讀校驗，記錄於 Manifest；`restore` 逐位元組還原；
  `--dry-run` 只預覽、不寫入任何檔案；寫入失敗自動回滾。IDE 同步更新 `product.json` 的 `checksums`，
  macOS App 同步更新 `Info.plist` 的 `ElectronAsarIntegrity`。
- **App 雙層機制**：靜態層翻譯主行程的原生選單、系統匣與更新提示；執行期注入層以 `MutationObserver` 即時翻譯 React UI，
  只注入 App 內部頁面，並嚴格排除程式碼、編輯器、終端機、可編輯區域、表單內容與 AI 回覆的 Markdown 正文。
- **自訂背景 `bg`**：使用自己的圖片或 5 款內建純 CSS 漸層預設，支援可讀性遮罩 `--tint`；換圖不需重新套用 `app.asar`，
  WSL 會自動把設定鏡像到 Windows 家目錄。
- **`Ctrl + Alt + B` 介面內背景面板**：在 Antigravity 裡直接選圖、換預設、調整參數，設定存於 IndexedDB，0 秒生效、免重開。
- **本機圖形控制台**：不帶參數執行即開啟，只監聽 `127.0.0.1`，每次啟動產生新的存取 Token，並檢查 `Host` 與 `Origin`。
- **僅背景模式 `--lang none`**：維持英文介面，只掛載背景與 `Ctrl + Alt + B` 面板。
- **零侵入模式 `rules`**：只安裝 `~/.gemini/config/rules` 全域規則，讓 AI 以指定語言回覆，不修改任何安裝檔。
- **友善的檔案鎖定錯誤**：`EBUSY` / `EPERM` / `EACCES` 會附上具體處理步驟，控制台另有重試按鈕。
- **三平台單檔執行檔**（Node.js SEA）：Windows x64、macOS Apple 晶片、Linux x64，免安裝 Node.js；
  推送 `v*` tag 時自動打包、冒煙測試並產生 `SHA256SUMS.txt`。
- **四語詞庫**：繁體中文、簡體中文、日文、韓文各 625 條，內建 CI 詞庫驗證（key 一致、佔位符、保護詞、繁簡用語）。
- 繁中／簡中／英文 README、Issue 與 PR 範本、`AGENTS.md` 協作規範。
