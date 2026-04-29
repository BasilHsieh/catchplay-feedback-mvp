# AGENTS.md

開始改這個專案前，先讀：

1. `PROJECT_CONTEXT.md`
2. `README.md`

跟使用者溝通請用台灣繁體中文。

這是一個很小的 Chrome Extension，沒有 package manager、build step 或測試框架。偏好小而直接的修改。

驗證指令：

```bash
node --check content.js
node --check popup.js
node --check background.js
jq '.' manifest.json
```

主要目標是維持 CATCHPLAY recommendation feedback payload 的資料品質。資料正確性比 UI polish 重要。

不要看到新的 scan 就直接相信結果；要先讀 `~/Downloads/catchplay-scan-*.json`，檢查 section、card、title、index 欄位是否合理。
