## 摘要 / Summary

<!-- 這個 PR 做了什麼、為什麼需要。What does this PR change and why? -->

## 變更類型 / Type of change

- [ ] 詞庫（新增或修正翻譯）/ Dictionary
- [ ] 錯誤修正 / Bug fix
- [ ] 新功能 / Feature
- [ ] 文件 / Docs

## 詞庫變更 / Dictionary changes

<!-- 只改程式碼可刪除此段。新增 key 請說明出現在哪個畫面（可附截圖）。 -->
<!-- New keys must state where they appear in the UI (screenshots welcome). -->

| 英文原文 | zh-TW | zh-CN | 出現位置 |
| --- | --- | --- | --- |
|  |  |  |  |

## 檢查清單 / Checklist

- [ ] `npm run typecheck` 通過
- [ ] `npm run build` 通過
- [ ] `npm test` 全部通過
- [ ] `node dist/cli.js validate` 回傳 exit code 0
- [ ] 新增的字串已同時加入 `zh-TW` 與 `zh-CN`，且 key 完全一致
- [ ] 遵守 [CONTRIBUTING.md](../CONTRIBUTING.md) 用語規範，沒有繁簡混用
- [ ] 佔位符（`{name}`、`%s`、`%d`）與保護詞皆已原樣保留
- [ ] 修改程式碼時已補上對應的單元測試，且測試只使用暫存目錄
- [ ] 變更 CLI 行為時已同步更新 README
- [ ] 修改 `src/runtime/` 時維持函式自足（不引用外部變數或 import）
