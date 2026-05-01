# Dev Log

工程決策記錄。每個重要架構轉折寫一段，包含為什麼當時這樣選、後來發現什麼、最後怎麼解。

寫給未來的我 / Claude / Codex / 接手 maintainer 看，避免重蹈覆轍。

---

## 2026-05-02：v0.2.0 toolbar 架構重寫

### 結論先寫

**toolbar 從「documentElement 上的單一全域元件 + JS hover 偵測」改成「每張卡 inject 自己的 toolbar + CSS :hover 觸發顯示」**。同時加 Radix HoverCard portal 偵測，preview 內也注入鏡像 toolbar，state 共享。

代碼位置：[`content.js`](content.js) `registerCard` / `injectToolbarIntoCard` / `injectToolbarIntoPortal` / `findRadixHoverCardRoot`。CSS：`.cpfb-card-host:hover > .cpfb-card-toolbar` + `.cpfb-card-host[data-state="open"] > .cpfb-card-toolbar`。

### 為什麼要重寫

v0.1.20 ~ v0.1.43 用全域單一 toolbar 撞牆 25 版（commits 在 `codex/fix-preview-toolbar-stability` branch 完整保留）。每個方案解一個問題、爆兩個新的：

| 嘗試版本 | 想解的問題 | 實際失敗模式 |
|---|---|---|
| v0.1.20-21 | toolbar 跟著 preview 大小變 | 只 scale font，沒處理 width |
| v0.1.22 | preview 跟 toolbar 視覺脫節 | 抓到 preview overlay，但只覆 hit-test 那層 |
| v0.1.23-24 | 抓到的 overlay 不是完整 preview | walk parent 抓更外層，但太外擴包到隔壁 row |
| v0.1.25 | 寬度視覺不對 | 強制 stretch toolbar 寬，視覺反而更糟 |
| v0.1.26-29 | 視覺架構爛 | 重新設計 layout、字體、blur 等視覺，沒解根本問題 |
| v0.1.30 | 加 state persistence (Netflix-like) | 功能加上去了 |
| v0.1.31 | 小卡 toolbar 溢出 | 加 scale-down，font 跟著縮但沒處理事件 |
| v0.1.32 | preview 在 cursor 移到 toolbar 時淡出 | 覆寫 overlay 元件 opacity:1 ，但 opacity 從父層繼承 |
| v0.1.33 | 同上 | 一路覆寫到 body 每層 opacity，發現根本不是 opacity |
| v0.1.34 | 診斷確認 preview 被 React unmount | 把 toolbar reparent 到 preview 內當 child |
| v0.1.35-39 | reparent 後位置算錯 | swiper-wrapper transform 把 position:fixed 變相對它 |
| v0.1.40-42 | 各種 transform 補償、重定位 | 補正算對的測試案例對，實際多卡型多 row 都炸 |
| v0.1.43 | preview pop 時 toolbar 跑很遠 | React 把 anchor.height 從 165 撐到 1233，bottom-anchored 失效 |

### 真正診斷出的根本原因（用 Chrome MCP 實測得到）

連續 inspect CATCHPLAY hover preview 才看清：

1. **preview 是 Radix UI HoverCard component**（class 含 `--radix-hover-card-trigger-width` CSS variable）
2. **preview 在 body level 的 portal 裡**，跟 trigger card 是 DOM 兄弟，不是 child
3. **cursor 從 trigger → portal**：Radix 自己會處理（preview 留住）；**cursor 從 portal → 全域 toolbar**：跨出 Radix 追蹤的子樹，preview 直接 unmount

這個發現翻轉了之前所有方向 — 不該用 JS 動態定位 + 全域 toolbar，該用 CSS + 每張卡自己的 toolbar。

### v0.2.x 架構決策

1. **toolbar 在 scan 階段直接 inject 進每張卡**（pre-injected，不是 hover 才插）
   - 為什麼：避開 JS hover 邏輯、Radix data-state 追蹤、React re-render 等複雜度
2. **CSS `:hover` + Radix `data-state="open"` 雙觸發**
   - 為什麼：cursor 在 trigger 直接 :hover 觸發；cursor 跑到 portal 時 trigger 仍有 data-state="open"，CSS 仍認得
3. **位置純 CSS `position: absolute`** 相對 card
   - 為什麼：避開 Swiper wrapper 的 transform 對 position:fixed 的干擾、避開 viewport 座標換算
4. **Radix portal 偵測 + 鏡像注入**：MutationObserver 監聽 body subtree，偵測 `[data-radix-popper-content-wrapper]` 出現時，往內找 `[data-state="open"]` 的元件，注入第二份 toolbar
   - 為什麼：portal 在 body level、z-index 高，trigger 內的 toolbar 會被視覺蓋住。直接在 portal 內也放一份。
5. **狀態共享靠 `data-card-state-key` attribute**：`syncAllToolbarsForKey(key, state)` 一次更新所有 match 的 toolbar
   - 為什麼：使用者可能在 trigger toolbar 或 portal toolbar 任一邊操作，狀態要同步

### 為什麼之前 25 版找不到根因

幾個我做錯的事：

1. **太早 commit + iterate**：每版改一點就試、看到一點問題就加 patch。沒有 step back 重新審視整體架構。
2. **沒有用 Chrome MCP 真實測**：只用 synthetic events 觸發，但 React 的 hover preview 有 `isTrusted` 檢查，synthetic events 觸發不到。導致一直在錯誤的環境下推論。
3. **猜測導向**：每次失敗就猜下一個原因，沒有先搞清楚 CATCHPLAY 用什麼框架。直到 v0.2.0 前才發現 Radix UI 這條線索。
4. **加 patch 不是重構**：一直在 v0.1.x 的全域 toolbar 架構上加修補，沒有把整個架構推倒重來的勇氣。

### 教訓

- **不確定根因前不要 commit code 當 fix**。先讓 hypothesis 成立，再寫 code。
- **Synthetic events ≠ real hover**。要驗證 React-driven 的 hover 行為一定要用真實 cursor + 連續監控（MutationObserver 抓 DOM 變化、log 屬性變化）。
- **超過 5 個 patch 還沒解掉就停下來**重新審架構，不要繼續疊。
- **用工具，不要用直覺**。Chrome MCP 給我的單一頁 DOM inspection 比 25 版猜測更值錢。
- **失敗的 branch 保留** — 既是 audit trail，也是教訓的記錄。

### 後續

- popup UI 一併重寫（v0.2.5）：layout 重排、現代化視覺、auto-save。
- v0.2.6：toggle 立即存（codex 的 v0.1.35 修法復刻）。
- v0.2.7：拿掉 Save 按鈕，文字欄位 debounced auto-save。

---

（未來新章節寫在上面，最舊的留下面。）
