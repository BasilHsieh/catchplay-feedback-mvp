# CATCHPLAY Feedback MVP

Hackathon 用的 Chrome Extension。在 CATCHPLAY 站內偵測影片 poster / card，使用者 hover 後顯示回饋按鈕，點擊後送出 JSON payload。

目前版本：**v0.1.19**。

兩種運作模式：
- **沒設定 Apps Script URL**：payload 只印在瀏覽器 console，適合 debug。
- **有設定 Apps Script URL**：payload 透過 background service worker POST 給 Apps Script。

---

## TL;DR：我們現在在哪

### 已經做完的事
- Extension 在 CATCHPLAY 上 5 種頁面都能偵測到影片卡：**首頁 / 詳情頁 / 主題頁 / 演員頁 / 分類頁**
- Hover 到任一張卡會跳出問句「喜歡這個推薦嗎？」+ 2 個按鈕（喜歡 / 不喜歡）
- 點按鈕會收集「**在哪頁、哪個版位、哪張卡、哪部片**」的資料，印到 console（如果有設 Apps Script URL 就會 POST 過去，但目前先沒接）
- 每個頁面 URL 都會自動分類成 `pageType` + 抓出 `pageContextId`（資源 ID），讓下游分析時能 group by 情境
- 已驗證：登入後 home 會出現個人化推薦版位 `List_ALL_BEHAVIOR_RECOMMEND` — 這是 feedback 對演算法最有價值的訊號來源

### 還沒做、要團隊決議的事
- **資料**：演算法側需要的 `data-algorithm-id` / `recommendation-reason` / `ranking-score` 等屬性，能不能請 CATCHPLAY 內部前端加？沒辦法的話 feedback 只能跟「版位 + 內容 ID」綁。
- **Apps Script + Sheet**：另一位隊友負責，本 extension 已經把資料 ready，等對方接。
- **互動方式 follow-up**：詳情頁的 hover 會跟 CATCHPLAY 自己的預覽影片重疊，使用上沒問題但視覺上有疊圖。試用後若覺得擾人，再考慮改右鍵 / 卡片角落固定按鈕（v2）。

### 已決議
- **按鈕設計**：採 YouTube-style 問句 + 2 顆按鈕（`喜歡` / `不喜歡`）。聚焦「員工是否覺得這是好推薦」單一訊號，避免 5 顆按鈕語意重疊。「已看過」這類訊號改由演算法隊友直接 cross-check 觀看紀錄取得，不靠使用者點擊。

### 你（UI / 前端負責人）下一步
1. **帶這份 README 找隊友開 30 分鐘對齊會** — 把上面「還沒做」那幾個問題逐一決議
2. 對齊完後回來改 extension：
   - 按鈕調整：改 `content.js` 的 `FEEDBACK_OPTIONS` 陣列，3 行 code
   - 互動方式變動：UI 重做，約半天
   - Schema 增刪：跟我講，我改

---

## 安裝 / 載入

1. `chrome://extensions`
2. 打開 Developer mode
3. Load unpacked → 選這個專案資料夾（含 `manifest.json` 那一層）
4. 開 CATCHPLAY 頁面
5. 點 extension icon，把 `Enable extension`（master 開關）跟 `Show detected cards` 打開
6. hover 影片 poster，確認回饋工具跳出來（題目「喜歡這個推薦嗎？」+ 喜歡 / 不喜歡 兩顆按鈕）
7. 點任一按鈕，DevTools console 看 payload

---

## Page type 分類

每個 payload 會根據當前 URL 標 `pageType`，下游分析時應該以 `(pageType, pageContextId, sectionListName)` 為主要 group key。

| pageType | URL pattern | `pageContextId` 來源 | 是否收 feedback |
|---|---|---|---|
| `home` | `/tw/home` | （空）| ✓ 主場 |
| `item` | `/tw/video/{uuid}` | uuid | ✓ 詳情頁含「同類型影片」/「導演演員其他作品」row |
| `theme` | `/tw/themes/{uuid}` | uuid | ✓ 策展頁，整頁就是一個 curation |
| `search_list` | `/tw/search/list?args=...` | `args` 字串 | ✓ Genre / 分類 / 各 row 的 see all 都是這頁 |
| `person` | `/tw/search/person/{slug}` | slug | ✓ 演員 / 導演頁，整頁是該人作品 |
| `tab` | `/tw/tab/{type}` | type (`SVOD`/`AVOD`/...) | ✓ 大分類 tab |
| `live_channel` | `/tw/live-channels/{uuid}` | uuid | △ 待確認直播頁是否有推薦 row |
| `editorial` | `/tw/ed-says[/...]` | （空 / slug）| △ 編輯文章，可能不收 |
| `info` | `/tw/plan-intro`、`/tw/info/...` | （空 / section）| ✗ 跳過 |
| `other` | 其他 | （空）| ✗ 跳過 |

> `search_list` 是一個 endpoint 涵蓋 genre 分類跟「see all」，**只有 `pageContextId` 不同**：純數字（如 `1009`）通常是 genre code、含 `#`（如 `DEFAULT#ALL#NEW_ARRIVAL_ALLBRAND`）通常是首頁某 row 的 see all。下游可進一步分類。

---

## Payload schema（v0.1.19）

```json
{
  "extensionVersion": "0.1.19",
  "capturedAt": "2026-04-25T17:42:49.474Z",
  "user": "basil",
  "feedbackType": "relevant",

  "pageUrl": "https://www.catchplay.com/tw/video/d18f6386-9e7b-4259-ae2d-fedc119667a7",
  "pagePath": "/tw/video/d18f6386-9e7b-4259-ae2d-fedc119667a7",
  "pageTitle": "《愛，墮落》線上看｜CATCHPLAY+ 正版電影專區",
  "pageType": "item",
  "pageContextId": "d18f6386-9e7b-4259-ae2d-fedc119667a7",

  "sectionTitle": "同類型影片",
  "sectionIndex": 1,
  "sectionListName": "",
  "sectionListIndexRaw": "",
  "sectionGtmId": "program-list",

  "itemIndex": 1,
  "gtmCardIndexRaw": "",

  "contentTitle": "我與哥哥的情婦",
  "contentHref": "https://www.catchplay.com/tw/video/0c311b45-e71c-46c7-ad20-5c20e20c1608",
  "contentId": "0c311b45-e71c-46c7-ad20-5c20e20c1608",
  "contentType": "video",
  "contentVariant": "",
  "contentLabels": [],
  "posterUrl": "https://material.asset.catchplay.com/.../P448.webp",

  "confidence": "high",
  "cardRect": { "x": 64, "y": 1130, "width": 288, "height": 192 },
  "debug": {
    "cardTag": "a",
    "cardClass": "cpfb-debug-card",
    "anchorText": "我與哥哥的情婦",
    "imageAlt": "我與哥哥的情婦",
    "gtm": { "card": {}, "list": { "data-gtm-id": "program-list" } }
  }
}
```

### 欄位語意

| 欄位 | 意義 |
|---|---|
| `pageType` / `pageContextId` | 這個 feedback 發生在「**哪一頁**」（情境） |
| `sectionTitle` / `sectionListName` / `sectionIndex` | 在該頁的「**哪一個 row / 版位**」 |
| `itemIndex` / `gtmCardIndexRaw` | 在該 row 的「**第幾張卡**」 |
| `contentId` / `contentTitle` / `contentHref` | 「**哪部片**」 |
| `contentVariant` | `MOVIE` / `SERIES` / `SEASON` / `CHANNEL` 等（首頁有，詳情頁通常空）|
| `contentLabels` | 例：`PAY_REQUIRED` / `FREE`（首頁有，詳情頁通常空）|
| `confidence` | `high` / `medium` / `low`，依抓到的欄位完整度 |
| `feedbackType` | 2 選 1：`relevant`（喜歡）/ `not_relevant`（不喜歡）|

---

## Data Audit：每個 pageType 拿得到的資料

### 首頁 / list 類（`home`、`tab`、`search_list`）

GTM 屬性齊全，欄位最豐富：

- `data-gtm-card-item-id`（內容 UUID）
- `data-gtm-card-item-name`（片名）
- `data-gtm-card-item-variant`（`MOVIE` / `SERIES` / `SEASON` / `CHANNEL`）
- `data-gtm-card-label`（`PAY_REQUIRED` / `FREE` 等）
- `data-gtm-card-index`（在該 row 的位置）
- `data-gtm-list-name`（演算法版位代號，例：`List_ALL_DEFAULT#ALL#TOP_RANKING`）
- `data-gtm-list-index`（第幾個版位）

→ payload 每個欄位都會填，`confidence: high`。

### 詳情頁 / 主題頁 / 演員頁（`item`、`theme`、`person`）

GTM 屬性**幾乎沒有**，只有 section 上的 `data-gtm-id="program-list"`。

→ 只能靠：
- anchor href 撈 UUID（`contentId`）
- img alt 撈片名（`contentTitle`）
- DOM heading 撈版位名稱（`sectionTitle`）

→ payload 主要欄位（`contentId` / `contentTitle` / `contentHref` / `posterUrl` / `sectionTitle`）OK，`confidence: high`；但 `contentVariant` / `contentLabels` / `gtmCardIndexRaw` / `sectionListName` 會空。

### 永遠拿不到（除非 CATCHPLAY 內部前端補）

- 演算法 ID / 模型版本
- 推薦理由（"因為你看過 X"）
- ranking score
- A/B 實驗 bucket

要這些就要請 CATCHPLAY 前端在 card 上補 `data-algorithm-id`、`data-rank`、`data-recommendation-reason`。

---

## 給 Apps Script 隊友的接法（建議）

### `doPost` 範本

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp
    .openById('GOOGLE_SHEET_ID')
    .getSheetByName('feedback');

  const data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    new Date(),
    data.user,
    data.feedbackType,
    data.pageType,
    data.pageContextId,
    data.pageUrl,
    data.pagePath,
    data.sectionTitle,
    data.sectionListName,
    data.sectionIndex,
    data.itemIndex,
    data.contentTitle,
    data.contentId,
    data.contentHref,
    data.contentType,
    data.contentVariant,
    (data.contentLabels || []).join(','),
    data.posterUrl,
    data.confidence,
    JSON.stringify(data.debug || {})
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### Google Sheet 第一列

```text
timestamp,user,feedbackType,pageType,pageContextId,pageUrl,pagePath,sectionTitle,sectionListName,sectionIndex,itemIndex,contentTitle,contentId,contentHref,contentType,contentVariant,contentLabels,posterUrl,confidence,debug
```

### 分析時建議的 group key

`(pageType, pageContextId, sectionListName)` — 把「使用者在哪個情境的哪個 row」分清楚。

---

## 需要團隊決議的事

開會前先想一下，這幾個問題會直接影響 extension 怎麼長：

### UX 側

（按鈕設計已在團隊內部釐清，採問句 + `喜歡` / `不喜歡` 兩顆按鈕。詳見 TL;DR 的「已決議」段。）

1. **同一張卡點兩次相反的 feedback** → Apps Script 端怎麼處理？（去重 / 取最後一次 / 全部記錄）
2. **詳情頁 hover 跟預覽影片重疊**的視覺體驗試用後若需調整，可改成右鍵 / 卡片角落固定按鈕（v2）。

### 資料側

1. 上面的「Data Audit」拿得到 / 拿不到清單，可不可以**請 CATCHPLAY 前端補上演算法相關屬性**？沒辦法的話，feedback 只能跟「演算法版位 + 內容 ID」綁，不能跟「具體推薦原因」綁。
2. `live_channel` / `editorial` 頁要不要收 feedback？

---

## 已知限制

- `sectionTitle`、`sectionIndex`、`itemIndex` 在沒有 GTM 屬性的頁面是 DOM 推測，不保證 100% 準。
- **Theme / search_list / person 頁的 `sectionTitle` 會被切成多塊**：這些頁面整頁本來就是一個 curation，但沒有 `data-gtm-list-name`，section 偵測退回 DOM heading 推測，會把片名誤認成版位名（例如把「進行曲」、「睡美人」當成 sectionTitle）。**Workaround**：下游分析這幾種 pageType 時直接用 `(pageType, pageContextId)` 當 group key，不要用 `sectionTitle`。要根治需要重寫 section 偵測邏輯（為這幾種 pageType 改成「整頁當一個 section」），約半天工作量。
- **登入後 home 可能繼續出現新的 `sectionListName`**。目前已收錄首頁常見 GTM list（含 `TOP_RANKING`、`MOST_POPULAR_ALLBRAND`、`CP_FREE_MOVIE`、`CP_FREE_SERIES`、`List_ALL_BEHAVIOR_RECOMMEND` 等）；若 scan JSON 又看到新 key，再補進 `titleFromListName`。
- Swiper 輪播會 re-render slides，造成 `registeredCards` 計數膨脹（debug panel 顯示偏大，但不影響 feedback）。
- `findItemIndex` 在沒有 `data-gtm-card-index` 的頁面靠 DOM 順序，遇到 swiper clones 可能略偏。
- `isFeedbackTargetCard` 目前收 `video` / `live_channel` / `theme` / `article` / `fanloop` 五種 `contentType`：
  - `article`（v0.1.17）：對應首頁 `List_ALL_ARTICLES`「編看編談」row 的 `/tw/ed-says/{slug}` 卡片
  - `fanloop`（v0.1.19）：對應首頁 `List_ALL_ADLIST_portraitadlist`「影音快遞」row 的 `https://www.fanloop.com/zh-TW/channel/{channel}/embed/{uuid}` 卡片，是 CATCHPLAY 跟 fanloop.com 合作的第三方 embed 短影片（唐綺陽星座、健康 2.0、感情諮詢等）
  - promotion / category banner 之類其他類型會被過濾掉，這是預期行為
- **非演算法 row 排除**：`List_ALL_CONTINUE_WATCHING`（繼續觀看）、`List_ALL_MY_DRAWER`（我的清單）、`List_ALL_RECENTLY_VIEWED`（你最近瀏覽過）三個 row 是「使用者狀態」row（不是演算法推薦），明確排除在 feedback 收集範圍外。如果有需要其他類別也排除，加進 `NON_RECOMMENDATION_LIST_NAMES` 即可。

---

## Scan 工作流（debug 用）

如果 hover 或版位偵測在某個頁面表現不準：

1. 開該頁面，等圖片載完，往下滑到底再回頂端（讓 lazy-load 都跑完）
2. extension popup → `Scan current page` → `Download scan JSON`
3. 檔案存在 `~/Downloads`，檔名格式 `catchplay-scan-{path-slug}-{YYYYMMDD-HHMMSS}.json`
4. 把檔名告訴 AI 助手，由他讀檔分析

scan 報表會列出該頁所有 section + 每個 section 的 cards + DOM 元素細節（class / data-attrs / DOM path），是調整偵測邏輯時的真實 ground truth。
