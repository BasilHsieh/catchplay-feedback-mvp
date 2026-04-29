# CLAUDE.md

開始處理這個專案前，先讀：

1. `PROJECT_CONTEXT.md`
2. `README.md`

回覆 Basil 時請用台灣繁體中文。

這是 CATCHPLAY recommendation feedback 的 Chrome Extension MVP。沒有 package manager、build step 或測試框架。

驗證指令：

```bash
node --check content.js
node --check popup.js
node --check background.js
jq '.' manifest.json
```

最重要的是維持 payload 資料品質：

- `pageType`
- `pageContextId`
- `sectionListName`
- `sectionTitle`
- `sectionIndex`
- `itemIndex`
- `contentId`
- `contentTitle`

debug 偵測問題時，優先讀最新的 `~/Downloads/catchplay-scan-*.json`。
