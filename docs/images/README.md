# 實機展示截圖（`docs/images/`）

這個資料夾存放 README 中「實機展示」區塊使用的截圖。五份 README 都已預留好圖片區塊（以 HTML 註解包住，目前不會顯示），
補上檔案後，刪除該區塊的 `<!--` 與 `-->` 兩行即可顯示。

> Screenshots for the "Screenshots" section of every README. Add files with the names below, mask personal data,
> then remove the `<!--` / `-->` lines around the image block in each README.

## 檔名約定

| 檔名 | 內容 |
| --- | --- |
| `control-panel.png` | 圖形控制台首頁（狀態總覽、一鍵操作、背景快捷設定） |
| `control-panel-shortcut.png` | 控制台的「桌面捷徑（智慧啟動器）」區塊 |
| `app-zh-TW.png` | Antigravity App 套用繁體中文後的首頁 |
| `app-zh-CN.png` | 套用簡體中文後的首頁 |
| `app-ja.png` | 套用日文後的首頁 |
| `app-ko.png` | 套用韓文後的首頁 |
| `panel-background.png` | `Ctrl + Alt + B` 面板：背景來源、內建漸層、桌布收藏夾與自動輪播 |
| `panel-appearance-lang.png` | `Ctrl + Alt + B` 面板：外觀微調（CJK 字型、毛玻璃）與介面語言切換 |
| `panel-scan.png` | `Ctrl + Alt + B` 面板：「掃描未翻譯英文」的結果 |

需要不同語系的版本時，在檔名後加上語系代碼，例如 `control-panel.en.png`、`panel-background.ja.png`；
README 預設使用沒有語系代碼的檔案。

## 截圖前必做：遮蓋個資

截圖會公開在 GitHub 上，**請務必先遮蓋或改用示範資料**：

- 帳號名稱、Email、頭像（首頁問候語「Good to see you, {name}」會顯示名字）
- 專案名稱、工作區名稱、對話標題與內容
- 檔案路徑中的使用者名稱（例如 `C:\Users\<你的名字>`、`/home/<你的名字>`）
- 控制台網址中的埠號無妨，但**不要**截到開發者工具裡的 `X-AGI18N-Token`
- 終端機視窗裡的主機名稱、IP 與其他程式的輸出

建議使用新建立的示範帳號與空白專案，並以馬賽克或色塊遮蓋，不要只用模糊（模糊可能被還原）。

## 圖片規格

- 格式：PNG（介面截圖）或 WebP；不要使用 GIF 錄影取代靜態圖
- 寬度：1280 ~ 1600 px，單張 **500 KB 以下**（可用 `pngquant`、`oxipng` 或 `cwebp` 壓縮）
- 深色主題為主，背景圖選用版權清楚的圖片（例如內建漸層預設，或自己拍攝的照片）
- 不要放入 `dist/`、`node_modules/` 等建置產物
