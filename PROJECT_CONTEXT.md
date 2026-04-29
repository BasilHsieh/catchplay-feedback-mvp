# 專案脈絡

這是 CATCHPLAY 推薦回饋用的 Chrome Extension MVP。新的 Codex / Claude Code session 請先讀這份，再讀 `README.md`。

## 目前狀態

- 版本：`0.1.19`
- 這個資料夾不是 git repo，沒有 package manager、build step 或測試框架。
- 主要檔案：
  - `manifest.json`：Chrome extension manifest。
  - `content.js`：偵測 card、顯示 hover toolbar、組 feedback payload、產 scan report。
  - `background.js`：有設定 Apps Script URL 時送出 payload。
  - `popup.html` / `popup.js` / `popup.css`：設定 UI、掃描頁面、下載 scan JSON。
  - `content.css`：注入 CATCHPLAY 頁面的 overlay/debug 樣式。

基本驗證指令：

```bash
node --check content.js
node --check popup.js
node --check background.js
jq '.' manifest.json
```

## 產品目標

在 CATCHPLAY 站內推薦卡上收集輕量 feedback。

payload 要回答三件事：

- 使用者在哪裡給 feedback：`pageType`、`pageContextId`、`pageUrl`、`sectionTitle`、`sectionListName`、`sectionIndex`。
- 使用者對哪張卡 / 哪部片給 feedback：`itemIndex`、`gtmCardIndexRaw`、`contentId`、`contentTitle`、`contentHref`、`contentType`。
- 使用者給了什麼 feedback：`feedbackType`。

沒設定 Apps Script URL 時，只在本機 console / toast 顯示。設定 Apps Script URL 後，`background.js` 會 POST JSON payload。

## 重要資料模型

下游分析建議主要 group key：

```text
(pageType, pageContextId, sectionListName)
```

重要欄位：

- `pageType`：從 URL 判斷，例如 `home`、`item`、`theme`、`search_list`、`person`、`tab`。
- `pageContextId`：目前頁面的 UUID / slug / search args。
- `sectionListName`：GTM list key。首頁 / list 類頁面最穩定的 row ID。
- `sectionTitle`：人類可讀的 row 標題；沒有 GTM 時會從 DOM 推測。
- `sectionIndex`：1-based section 位置。首頁 Hero 是 `1`，其他首頁 GTM row 會往後位移。
- `itemIndex`：1-based card 位置。
- `gtmCardIndexRaw`：原始 GTM card index，保留給 debug。

## 最近重要修正

- `normalizeGtmIndex(value)` 永遠 `+ 1`（0-based GTM index → 1-based payload itemIndex）。之前條件式寫錯，0 跟 1 都會變成 1，造成 row 內排名重複。
- `deriveSectionIndex(listName, listIndexRaw)`：`List_ALL_HOT_PICKS` 固定回 `0`，讓 Hero 排在所有 listIndex 來源的 section 之前，避免跟 sectionIndex 9 撞號。其他 row 使用 `normalizeListIndex(listIndexRaw)`（即 `listIndexRaw + 1`）。
- `derivePageType(url)` / `derivePageContextId(url)`：從 URL 直接判斷 `home` / `item` / `theme` / `search_list` / `person` / `tab` / `live_channel` / `editorial` / `info` / `other`，並抽出資源 ID 進 payload。
- `findContentTitle(...)` 把 `card.innerText` fallback 拆出來，先過 `stripCatchplayBadges()` 移除 `EXCLUSIVE` / `4K` / `HDR` / `DOLBY` / `單片租借` / `免費` / `超前鉅片` / `每週上線` 等 badge 字串再接受片名。`isUsefulTitle` 也加 `isLikelyBadge` 過濾 2-8 個字母的 ID-like 全大寫字串。
- `titleFromListName(...)` 已收錄首頁所有觀察到的 GTM list（含登入後出現的個人化 row）：
  - `List_ALL_HOT_PICKS`
  - `List_ALL_DEFAULT#ALL#LIVE_TV` / `List_ALL_PREMIUM#ALL#LIVE_TV` / `List_ALL_BASIC#ALL#LIVE_TV`
  - `List_ALL_{DEFAULT,BASIC}#ALL#NEW_ARRIVAL_ALLBRAND`
  - `List_ALL_{DEFAULT,BASIC}#ALL#TOP_RANKING`
  - `List_ALL_{DEFAULT,BASIC}#ALL#MOST_POPULAR_ALLBRAND`
  - `List_ALL_{DEFAULT,BASIC}#ALL#CP_FREE_MOVIE`
  - `List_ALL_{DEFAULT,BASIC}#ALL#CP_FREE_SERIES`
  - `List_ALL_BASIC#ALL#EDITORPICKS_3` / `List_ALL_BASIC#ALL#EDITORPICKS_5`
  - `List_ALL_BEHAVIOR_RECOMMEND`
  - `List_ALL_DISCOVER_NEW`
  - `List_ALL_ADLIST_adlist` / `adliste` / `thematicadlist` / `portraitadlist`
  - `List_ALL_ARTICLES`
- `NON_RECOMMENDATION_LIST_NAMES`（明確排除的「使用者狀態」row，不是演算法推薦）：
  - `List_ALL_CONTINUE_WATCHING`
  - `List_ALL_MY_DRAWER`
  - `List_ALL_RECENTLY_VIEWED`
- 詳情頁 hover 偵測：`findRegisteredCardFromTarget` 多了座標 fallback (`findCardAtPoint`)。CATCHPLAY 詳情頁的卡片有 overlay sibling 攔截 pointer events，DOM 走父層找不到 registered card 時改用滑鼠座標判斷哪張 card rect 包含當前點。
- 回饋工具消失邏輯：mouseleave 觸發時先檢查游標座標是否還在卡片區域內（含 `state.lastCardRect` 後備），CATCHPLAY 預覽動畫造成的「假性 leave」會被忽略。`state.toolbarHovered` flag 鎖住 hide 倒數，回饋工具被 hover 時不會消失。`requestAnimationFrame` 持續對齊回饋工具到卡片新位置（卡片放大時 follow）。

## Scan 工作流

偵測不準時，不要盲改。先拿 scan JSON 當 ground truth。

1. 到 `chrome://extensions` reload unpacked extension。
2. 開 CATCHPLAY 目標頁，等圖片 / lazy-load。
3. Extension popup -> `Scan current page` -> `Download scan JSON`。
4. JSON 會在 `~/Downloads`，檔名類似 `catchplay-scan-{path-slug}-{timestamp}.json`。
5. 檢查：
   - `sectionTitle` / `sectionListName`
   - 是否有重複或缺漏 `itemIndex`
   - `contentTitle` 是否變成 `EXCLUSIVE`、`4K`、`免費` 這類 badge
   - swiper offscreen slides 是否造成 scan 數量膨脹

## 已知限制

- 沒有 GTM 屬性的頁面，`sectionTitle`、`sectionIndex`、`itemIndex` 都是 DOM 推測，可能不準。
- Theme / search / person 頁可能把同一個 curation 切成多個 inferred sections。下游分析這些頁面時，先用 `(pageType, pageContextId)` group，不要太相信 `sectionTitle`。
- Swiper 會 re-render slides，可能讓 `registeredCards` debug count 膨脹；通常不影響 feedback payload。
- extension 不能憑空知道 DOM 裡沒有的演算法資訊，例如 model ID、推薦理由、ranking score、A/B bucket。要這些需要 CATCHPLAY 前端補 data attributes。

## 已決議

- feedback 按鈕收斂為 2 顆：`relevant`（喜歡）／ `not_relevant`（不喜歡）。`FEEDBACK_OPTIONS` 已對應，`FEEDBACK_QUESTION = "喜歡這個推薦嗎？"` 跟著問句一起顯示。原本 5 顆中的 `already_watched` / `why_recommended` / `more_like_this` 全部砍除。
- 「使用者狀態」row（`CONTINUE_WATCHING` / `MY_DRAWER` / `RECENTLY_VIEWED`）明確排除，不收 feedback。

## 2026-04-28 會議追加待辦

- ~~**首頁 ed-say row**~~：v0.1.17 完成。釐清 = `List_ALL_ARTICLES`（DOM headingText「編看編談」），cards href `/tw/ed-says/{slug}`，[content.js:979](content.js:979) 判成 `article` contentType，原本被 `isFeedbackTargetCard` 排除。處理：
  1. mapping `List_ALL_ARTICLES`: `"A輯推薦"` → `"編看編談"`（對齊 DOM）
  2. `isFeedbackTargetCard` allowed list 加 `"article"`
- ~~**首頁 fanloop row**~~：v0.1.19 完成。釐清 = `List_ALL_ADLIST_portraitadlist`（DOM headingText「影音快遞 (AI生成多國語音)」）。**「fanloop」是字面意思** — cards 的 href 是 `https://www.fanloop.com/zh-TW/channel/{channelId}/embed/{uuid}`（CATCHPLAY 跟 fanloop.com 合作的第三方 embed 短影片，唐綺陽星座、健康 2.0 等），所以 `deriveContentType` 看不懂回 `"other"`，被 `isFeedbackTargetCard` 排除。處理：
  1. `deriveContentType` 對 `*.fanloop.com` host 回 `"fanloop"`（保留語意）
  2. `isFeedbackTargetCard` allowed list 加 `"fanloop"`
  3. `deriveContentId` 不用改 — 取 pathname 最後一段，剛好是 fanloop UUID
  - payload 範例：`contentType: "fanloop"` / `contentId: "209dccd2-fe0e-422c-80be-414a8b5babe0"` / `contentHref: "https://www.fanloop.com/..."` / `sectionListName: "List_ALL_ADLIST_portraitadlist"` / `sectionTitle: "影音快遞"`
- **Scan 報表 sections 缺號 row**（不動）：scan 報表的 `sections` 比 `domListNames` 少 11 個 row。其中：`CONTINUE_WATCHING` 是明確排除的「使用者狀態」row（正常）；`ARTICLES`（編看編談 / ed-say）已 v0.1.17 修；`portraitadlist`（影音快遞 / fanloop）debug 中；`PERSONAL_PLAYLIST`（以我的片單呼喚你）使用者要求不動；剩下 6 個 `EDITORPICKS_6/7/10` / `COMING_SOON` / `IMDB` / `UNPUBLISHED_ALLBRAND` 的 cards href 是正常 video，DOM 上有 anchors，懷疑是 scan 在頁頂跑時 row 在 viewport 下方很遠、swiper 還沒 render slides 造成。**對 real user 無感**（滾到時 `setInterval(scanForCards, 2500)` 會抓到、hover 跳 toolbar 正常）。要 scan 報表抓全：scan 前滾到底再回頂端讓所有 swiper render。**結論**：不動 code。
- **`PERSONAL_PLAYLIST` row（以我的片單呼喚你）**（不做）：使用者明示不需要支援。`anchorCount: 0` 結構特殊（cards 沒被 `<a href>` 包起來），需要重寫 `findCardElements` 才抓得到，但既然不做就不動。
- ~~**Extension 全域 on/off 開關**~~：v0.1.16 完成。把原本的 `enabled` (`Enable hover feedback`) 升級為 master kill switch，label 改為 `Enable extension`。Disabled 時：不掃描、不顯示 toolbar / highlight / debug panel、清掉所有卡片上的 debug class、scan 訊息回拒絕錯誤（`silenceUi()`）。`updateDebugPanel` 也跟著 master 走（master off → debug panel 強制隱藏）。
- ~~**首頁 GTM list 命名變更 (`DEFAULT` → `BASIC`)**~~：v0.1.16 補上 `BASIC` 系列對應（`LIVE_TV` / `NEW_ARRIVAL_ALLBRAND` / `TOP_RANKING` / `MOST_POPULAR_ALLBRAND` / `CP_FREE_MOVIE` / `CP_FREE_SERIES`），並新增 `EDITORPICKS_3` (戲院看不到的好片) / `EDITORPICKS_5` (向經典致敬)。舊 `DEFAULT` 對應保留以防回滾。

## 尚待團隊決議

- 演算法側需要的 `data-algorithm-id` / `recommendation-reason` / `ranking-score` 等屬性，能不能請 CATCHPLAY 內部前端加？沒有的話，feedback 只能跟「版位 + 內容 ID」綁，不能跟「具體推薦原因」綁。
- `live_channel`、`editorial`、promotion、article card 要不要收 feedback？目前 `isFeedbackTargetCard` 只收 `video` / `live_channel` / `theme` 三種 contentType。
- Apps Script 端遇到同一個 `(user, page context, section, content)` 重複 feedback 時要怎麼去重？
- 詳情頁 hover toolbar 跟 CATCHPLAY 自己的 hover preview 重疊，使用上沒問題但視覺有疊圖。試用後若需要可改成右鍵選單 / 卡片角落固定按鈕（v2）。

## Review 優先順序

review 時先看資料正確性，不要先追 UI polish。

優先檢查：

1. `contentTitle`
2. `contentId`
3. `itemIndex`
4. `sectionListName`
5. `sectionIndex`
6. `pageType` / `pageContextId`

README 保持給團隊 / 使用者看的內容；AI session handoff 和目前工程脈絡放這份檔案。
