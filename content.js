(() => {
  const EXTENSION_VERSION = chrome.runtime?.getManifest?.().version || "0.2.1";
  const GTM_CARD_ATTRIBUTES = [
    "data-gtm-card-index",
    "data-gtm-card-item-id",
    "data-gtm-card-item-name",
    "data-gtm-card-list-name"
  ];
  const GTM_LIST_ATTRIBUTES = [
    "data-gtm-list-index",
    "data-gtm-list-name",
    "data-gtm-id"
  ];
  const FEEDBACK_QUESTION = "喜歡這個推薦嗎？";
  const FEEDBACK_OPTIONS = [
    { type: "relevant", label: "喜歡", tone: "positive" },
    { type: "not_relevant", label: "不喜歡", tone: "negative" }
  ];
  const FEEDBACK_CLEARED_TYPE = "cleared";
  const STATE_STORAGE_PREFIX = "cpfb-feedback-state";
  const FEEDBACK_ICONS = {
    positive:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    negative:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
  };
  const NON_RECOMMENDATION_LIST_NAMES = new Set([
    "List_ALL_CONTINUE_WATCHING",
    "List_ALL_MY_DRAWER",
    "List_ALL_RECENTLY_VIEWED"
  ]);
  const TITLE_BADGE_LABELS = new Set([
    "4k",
    "hdr",
    "dolby",
    "dolby vision",
    "dolby atmos",
    "exclusive",
    "coming soon",
    "free",
    "login_required",
    "new_ep_weekly",
    "new_season",
    "pay_required",
    "pvod",
    "single_rental_only",
    "thematic",
    "tvod",
    "免費",
    "免費看",
    "單片租借",
    "超前鉅片",
    "每週上線",
    "即將上架",
    "新季",
    "新一季",
    "新",
    "獨家",
    "首播",
    "付費會員免廣告",
    "▋"
  ]);

  const state = {
    enabled: true,
    debugMode: false,
    registeredCards: new WeakSet(),
    registeredCardElements: new Set(),
    registeredCardCount: 0,
    cardObservers: new WeakMap(),
    scanTimer: 0,
    toastTimer: 0
  };

  const debugPanel = createDebugPanel();
  const toast = createToast();

  document.documentElement.append(debugPanel, toast);

  chrome.storage.sync.get(
    {
      enabled: true,
      debugMode: false
    },
    (items) => {
      state.enabled = Boolean(items.enabled);
      state.debugMode = Boolean(items.debugMode);
      updateDebugPanel();
      scanForCards();
    }
  );

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      state.enabled = Boolean(changes.enabled.newValue);
      if (!state.enabled) {
        silenceUi();
      } else {
        unsilenceUi();
        updateDebugPanel();
      }
      scheduleScan();
    }

    if (changes.debugMode) {
      state.debugMode = Boolean(changes.debugMode.newValue);
      updateDebugPanel();
      scheduleScan();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "CPF_SCAN_PAGE") {
      return false;
    }

    if (!state.enabled) {
      sendResponse({
        ok: false,
        error: "Extension is disabled. Toggle 'Enable extension' on first."
      });
      return false;
    }

    try {
      scanForCards();
      const report = scanPageStructure();
      console.log("[CATCHPLAY Feedback MVP] page scan", report);
      sendResponse({ ok: true, report });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return false;
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(scanForCards, 2500);

  function buildCardToolbar(card) {
    const element = document.createElement("div");
    element.className = "cpfb-card-toolbar";

    const prompt = document.createElement("div");
    prompt.className = "cpfb-card-prompt";
    prompt.textContent = FEEDBACK_QUESTION;
    element.append(prompt);

    const buttonRow = document.createElement("div");
    buttonRow.className = "cpfb-card-buttons";

    for (const option of FEEDBACK_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cpfb-card-button cpfb-card-button--${option.tone}`;
      button.dataset.feedbackType = option.type;
      button.title = option.label;
      button.innerHTML =
        `<span class="cpfb-card-icon">${FEEDBACK_ICONS[option.tone]}</span>` +
        `<span class="cpfb-card-label">${option.label}</span>`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.blur();
        submitFeedback(card, element, option.type);
      });
      buttonRow.append(button);
    }

    element.append(buttonRow);

    // Stop card-level handlers (e.g., link click) bubbling from toolbar
    ["pointerdown", "pointerup", "mousedown", "mouseup", "click"].forEach((type) => {
      element.addEventListener(type, (event) => event.stopPropagation());
    });

    return element;
  }

  function createDebugPanel() {
    const element = document.createElement("div");
    element.className = "cpfb-debug-panel";
    element.hidden = true;
    return element;
  }

  function createToast() {
    const element = document.createElement("div");
    element.className = "cpfb-toast";
    element.hidden = true;
    return element;
  }

  function scheduleScan() {
    clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(scanForCards, 250);
  }

  function scanForCards() {
    if (!state.enabled) {
      updateDebugPanel();
      return;
    }

    const cards = findCardElements(document);

    for (const card of cards) {
      registerCard(card);
    }

    updateDebugPanel();
  }

  function registerCard(card) {
    if (!card || state.registeredCards.has(card)) {
      return;
    }

    state.registeredCards.add(card);
    state.registeredCardElements.add(card);
    state.registeredCardCount += 1;

    if (state.debugMode) {
      card.classList.add("cpfb-debug-card");
      findBestPoster(card)?.classList.add("cpfb-debug-card");
    }

    card.classList.add("cpfb-card-host");

    // Ensure card is positioned so toolbar's absolute layout is relative to it
    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
    }

    injectToolbarIntoCard(card);

    // React may re-render and remove our toolbar — observe and re-inject
    const observer = new MutationObserver(() => {
      if (!card.isConnected) return;
      if (!card.querySelector(":scope > .cpfb-card-toolbar")) {
        injectToolbarIntoCard(card);
      }
    });
    observer.observe(card, { childList: true });
    state.cardObservers.set(card, observer);
  }

  function injectToolbarIntoCard(card) {
    if (!card || !card.isConnected) return;
    if (card.querySelector(":scope > .cpfb-card-toolbar")) return;

    const toolbar = buildCardToolbar(card);
    card.appendChild(toolbar);
    refreshCardToolbar(card, toolbar);
  }

  async function refreshCardToolbar(card, toolbar) {
    const tb = toolbar || card.querySelector(":scope > .cpfb-card-toolbar");
    if (!tb) return;

    try {
      const { userName } = await chrome.storage.sync.get(["userName"]);
      const anchor = findAnchor(card);
      const metadata = getCardMetadata(card);
      const sectionInfo = getSectionInfo(card, metadata);
      const contentHref = normalizeUrl(anchor?.getAttribute("href") || "");
      const contentId = getUsefulGtmItemId(metadata.itemId) || deriveContentId(contentHref);
      const stateKey = buildStateKey({
        pageType: derivePageType(location.href),
        pageContextId: derivePageContextId(location.href),
        sectionListName: sectionInfo.listName,
        contentId
      });
      const stored = await getStoredFeedbackState(userName || "", stateKey);
      applyToolbarSelectedState(tb, stored?.feedbackType || null);
    } catch (error) {
      console.warn("[CATCHPLAY Feedback MVP] state lookup failed", error);
    }
  }

  function applyToolbarSelectedState(toolbar, feedbackType) {
    if (!toolbar) return;
    const buttons = toolbar.querySelectorAll(".cpfb-card-button");
    for (const button of buttons) {
      if (feedbackType && button.dataset.feedbackType === feedbackType) {
        button.classList.add("cpfb-card-button--selected");
      } else {
        button.classList.remove("cpfb-card-button--selected");
      }
    }
  }


  async function submitFeedback(card, toolbar, clickedType) {
    if (!state.enabled) return;
    if (!card) return;

    const payload = await buildPayload(card, clickedType);
    const stateKey = buildStateKey(payload);
    const userName = payload.user || "";
    const previousEntry = await getStoredFeedbackState(userName, stateKey);
    const isToggleOff = previousEntry?.feedbackType === clickedType;

    if (isToggleOff) {
      payload.feedbackType = FEEDBACK_CLEARED_TYPE;
      payload.previousFeedbackType = clickedType;
      await setStoredFeedbackState(userName, stateKey, null);
      applyToolbarSelectedState(toolbar, null);
    } else {
      await setStoredFeedbackState(userName, stateKey, clickedType);
      applyToolbarSelectedState(toolbar, clickedType);
    }

    console.log("[CATCHPLAY Feedback MVP] payload", payload);
    showToast(isToggleOff ? "Updating feedback..." : "Sending feedback...");

    chrome.runtime.sendMessage(
      {
        type: "CPF_SUBMIT_FEEDBACK",
        payload
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("[CATCHPLAY Feedback MVP] submit error", chrome.runtime.lastError);
          showToast(`Submit failed: ${chrome.runtime.lastError.message}`);
          return;
        }

        if (!response || !response.ok) {
          console.error("[CATCHPLAY Feedback MVP] submit failed", response);
          showToast("Submit failed. See console.");
          return;
        }

        if (response.skipped) {
          showToast("Captured locally. Add Apps Script URL to submit.");
          return;
        }

        showToast(isToggleOff ? "Feedback cleared." : "Feedback submitted.");
      }
    );
  }

  function buildStateKey(payload) {
    return [
      payload.pageType || "",
      payload.pageContextId || "",
      payload.sectionListName || "",
      payload.contentId || ""
    ].join("|");
  }

  function stateStorageKey(userName) {
    const safe = (userName || "").trim() || "anonymous";
    return `${STATE_STORAGE_PREFIX}:${safe}`;
  }

  async function getStoredFeedbackState(userName, stateKey) {
    const storageKey = stateStorageKey(userName);
    const stored = await chrome.storage.local.get(storageKey);
    const map = stored[storageKey] || {};
    return map[stateKey] || null;
  }

  async function setStoredFeedbackState(userName, stateKey, feedbackType) {
    const storageKey = stateStorageKey(userName);
    const stored = await chrome.storage.local.get(storageKey);
    const map = stored[storageKey] || {};

    if (feedbackType === null) {
      delete map[stateKey];
    } else {
      map[stateKey] = { feedbackType, updatedAt: new Date().toISOString() };
    }

    await chrome.storage.local.set({ [storageKey]: map });
  }

  async function buildPayload(card, feedbackType) {
    const { userName } = await chrome.storage.sync.get(["userName"]);
    const anchor = findAnchor(card);
    const poster = findBestPoster(card);
    const metadata = getCardMetadata(card);
    const sectionInfo = getSectionInfo(card, metadata);
    const section = sectionInfo.element;
    const sectionTitle = sectionInfo.title;
    const contentTitle = findContentTitle(card, anchor, poster, metadata.itemName);
    const contentHref = normalizeUrl(anchor?.getAttribute("href") || "");
    const posterUrl = normalizeUrl(getPosterUrl(poster));
    const itemIndex = normalizeGtmIndex(metadata.cardIndexRaw, metadata) ?? findItemIndex(section, card);
    const sectionIndex = sectionInfo.sectionIndex ?? findSectionIndex(section);
    const contentId = getUsefulGtmItemId(metadata.itemId) || deriveContentId(contentHref);
    const contentType = deriveContentType(contentHref);
    const confidence = getConfidence({
      sectionTitle,
      contentTitle,
      contentHref,
      posterUrl
    });
    const rect = getVisibleRect(card);

    return {
      extensionVersion: EXTENSION_VERSION,
      capturedAt: new Date().toISOString(),
      user: userName || "",
      feedbackType,
      pageUrl: location.href,
      pagePath: location.pathname,
      pageTitle: document.title,
      pageType: derivePageType(location.href),
      pageContextId: derivePageContextId(location.href),
      sectionTitle,
      sectionIndex,
      sectionListName: sectionInfo.listName,
      sectionListIndexRaw: sectionInfo.listIndexRaw,
      sectionGtmId: sectionInfo.gtmId,
      itemIndex,
      gtmCardIndexRaw: metadata.cardIndexRaw,
      contentTitle,
      contentHref,
      contentId,
      contentType,
      contentVariant: metadata.itemVariant,
      contentLabels: metadata.itemLabels,
      posterUrl,
      confidence,
      cardRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      debug: {
        cardTag: card.tagName.toLowerCase(),
        cardClass: trimText(card.className || "", 140),
        anchorText: trimText(anchor?.innerText || "", 180),
        imageAlt: trimText(poster?.getAttribute("alt") || "", 140),
        gtm: metadata.raw
      }
    };
  }

  function scanPageStructure() {
    const cards = findCardElements(document)
      .sort((a, b) => {
        const aRect = getVisibleRect(a);
        const bRect = getVisibleRect(b);
        return aRect.top - bRect.top || aRect.left - bRect.left;
      })
      .slice(0, 180);
    const sectionGroups = new Map();

    for (const card of cards) {
      const sectionInfo = getSectionInfo(card);
      if (!sectionGroups.has(sectionInfo.key)) {
        sectionGroups.set(sectionInfo.key, {
          info: sectionInfo,
          cards: []
        });
      }
      sectionGroups.get(sectionInfo.key).cards.push(card);
    }

    const sections = Array.from(sectionGroups.values())
      .sort((a, b) => {
        const aIndex = a.info.sectionIndex ?? Number.MAX_SAFE_INTEGER;
        const bIndex = b.info.sectionIndex ?? Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex || getVisibleRect(a.info.element).top - getVisibleRect(b.info.element).top;
      })
      .map(({ info, cards: sectionCards }, sectionIndex) => {
        const section = info.element;
        const firstCard = sectionCards[0];
        const sectionRect = getVisibleRect(section);

        return {
          sectionIndex: info.sectionIndex ?? sectionIndex + 1,
          sectionTitle: info.title || findSectionTitle(section, firstCard),
          sectionListName: info.listName,
          sectionListIndexRaw: info.listIndexRaw,
          sectionGtmId: info.gtmId,
          cardCount: sectionCards.length,
          rect: rectToObject(sectionRect),
          element: describeElement(section),
          textSample: trimText(section.innerText || section.textContent || "", 220),
          cards: sectionCards.slice(0, 40).map((card, itemIndex) => describeCardForScan(card, itemIndex + 1))
        };
      });

    return {
      extensionVersion: EXTENSION_VERSION,
      capturedAt: new Date().toISOString(),
      pageUrl: location.href,
      pagePath: location.pathname,
      pageTitle: document.title,
      pageType: derivePageType(location.href),
      pageContextId: derivePageContextId(location.href),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY)
      },
      totals: {
        registeredCards: state.registeredCardCount,
        cardsDetectedNow: cards.length,
        sectionsDetected: sections.length,
        links: document.links.length,
        images: document.images.length
      },
      domListNames: collectAllDomListNames(),
      sections
    };
  }

  function collectAllDomListNames() {
    const seen = new Map();
    document.querySelectorAll("[data-gtm-list-name]").forEach((element) => {
      const listName = element.getAttribute("data-gtm-list-name") || "";
      if (!listName || seen.has(listName)) {
        return;
      }
      const listIndexRaw = element.getAttribute("data-gtm-list-index") || "";
      const gtmId = element.getAttribute("data-gtm-id") || "";
      const headingEl = element.querySelector(
        "h1, h2, h3, h4, h5, [class*='title' i], [class*='heading' i], [class*='Title']"
      );
      const headingText = trimText(headingEl?.textContent || "", 80);
      const sampleText = trimText(element.innerText || element.textContent || "", 140);
      const cardCount = element.querySelectorAll(
        "[data-gtm-card-item-id], [data-gtm-card-item-name]"
      ).length;
      const anchorCount = element.querySelectorAll("a[href]").length;
      const rect = getVisibleRect(element);
      const sampleAnchors = Array.from(element.querySelectorAll("a[href]"))
        .slice(0, 3)
        .map((a) => ({
          href: a.getAttribute("href") || "",
          contentType: deriveContentType(normalizeUrl(a.getAttribute("href") || "")),
          text: trimText(a.textContent || "", 50)
        }));
      const sampleGtmCards = Array.from(
        element.querySelectorAll("[data-gtm-card-item-id], [data-gtm-card-item-name]")
      )
        .slice(0, 3)
        .map((card) => {
          const anchor = findAnchor(card) || card.querySelector?.("a[href]");
          const href = anchor?.getAttribute("href") || "";
          return {
            tag: card.tagName.toLowerCase(),
            className: typeof card.className === "string" ? card.className.slice(0, 80) : "",
            gtmItemId: card.getAttribute("data-gtm-card-item-id") || "",
            gtmItemName: card.getAttribute("data-gtm-card-item-name") || "",
            gtmVariant: card.getAttribute("data-gtm-card-item-variant") || "",
            anchorHref: href,
            anchorContentType: deriveContentType(normalizeUrl(href)),
            cardRect: rectToObject(card.getBoundingClientRect()),
            isReasonable: isReasonableCard(anchor || card),
            isFeedbackTarget: isFeedbackTargetCard(anchor || card)
          };
        });
      seen.set(listName, {
        listName,
        listIndexRaw,
        gtmId,
        headingText,
        sampleText,
        gtmCardCount: cardCount,
        anchorCount,
        rect: rectToObject(rect),
        sampleAnchors,
        sampleGtmCards
      });
    });
    return Array.from(seen.values()).sort((a, b) => {
      const ai = Number.parseInt(a.listIndexRaw, 10);
      const bi = Number.parseInt(b.listIndexRaw, 10);
      if (Number.isNaN(ai) && Number.isNaN(bi)) return 0;
      if (Number.isNaN(ai)) return 1;
      if (Number.isNaN(bi)) return -1;
      return ai - bi;
    });
  }

  function describeCardForScan(card, itemIndex) {
    const anchor = findAnchor(card);
    const poster = findBestPoster(card);
    const metadata = getCardMetadata(card);
    const rect = getVisibleRect(card);
    const contentHref = normalizeUrl(anchor?.getAttribute("href") || "");
    const sectionInfo = getSectionInfo(card, metadata);

    return {
      itemIndex: normalizeGtmIndex(metadata.cardIndexRaw, metadata) ?? itemIndex,
      gtmCardIndexRaw: metadata.cardIndexRaw,
      sectionListName: sectionInfo.listName,
      contentTitle: findContentTitle(card, anchor, poster, metadata.itemName),
      contentHref,
      contentId: getUsefulGtmItemId(metadata.itemId) || deriveContentId(contentHref),
      contentType: deriveContentType(contentHref),
      contentVariant: metadata.itemVariant,
      contentLabels: metadata.itemLabels,
      posterUrl: normalizeUrl(getPosterUrl(poster)),
      rect: rectToObject(rect),
      gtm: metadata.raw,
      card: describeElement(card),
      anchor: describeElement(anchor),
      image: describeElement(poster),
      textSample: trimText(card.innerText || card.textContent || "", 160)
    };
  }

  function describeElement(element) {
    if (!element) {
      return null;
    }

    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      className: trimText(element.className || "", 180),
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      href: normalizeUrl(element.getAttribute("href") || ""),
      src: normalizeUrl(element.currentSrc || element.getAttribute("src") || ""),
      alt: element.getAttribute("alt") || "",
      data: getDataAttributes(element),
      path: getDomPath(element)
    };
  }

  function getDataAttributes(element) {
    const data = {};

    for (const attribute of Array.from(element.attributes || [])) {
      if (attribute.name.startsWith("data-")) {
        data[attribute.name] = trimText(attribute.value, 180);
      }
    }

    return data;
  }

  function getDomPath(element) {
    const parts = [];
    let current = element;

    for (let depth = 0; current && current.nodeType === Node.ELEMENT_NODE && depth < 7; depth += 1) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        part += `#${current.id}`;
        parts.unshift(part);
        break;
      }

      const classes = String(current.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3);

      if (classes.length) {
        part += `.${classes.join(".")}`;
      }

      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children)
          .filter((sibling) => sibling.tagName === current.tagName);
        const index = siblings.indexOf(current);
        if (siblings.length > 1 && index >= 0) {
          part += `:nth-of-type(${index + 1})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function rectToObject(rect) {
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function getCardMetadata(card) {
    const anchor = findAnchor(card);
    const cardElement =
      findClosestWithAnyAttribute(card, GTM_CARD_ATTRIBUTES, 8) ||
      findClosestWithAnyAttribute(anchor, GTM_CARD_ATTRIBUTES, 8);
    const listElement =
      findClosestWithAnyAttribute(card, GTM_LIST_ATTRIBUTES, 12) ||
      findClosestWithAnyAttribute(anchor, GTM_LIST_ATTRIBUTES, 12);

    const raw = {
      card: cardElement ? getDataAttributes(cardElement) : {},
      list: listElement ? getDataAttributes(listElement) : {}
    };

    return {
      cardElement,
      listElement,
      itemId: getAttributeValue(cardElement, "data-gtm-card-item-id"),
      itemName: getAttributeValue(cardElement, "data-gtm-card-item-name"),
      itemVariant: getAttributeValue(cardElement, "data-gtm-card-item-variant"),
      itemLabels: splitLabels(getAttributeValue(cardElement, "data-gtm-card-label")),
      cardIndexRaw: getAttributeValue(cardElement, "data-gtm-card-index"),
      cardListName: getAttributeValue(cardElement, "data-gtm-card-list-name"),
      listName: getAttributeValue(listElement, "data-gtm-list-name"),
      listIndexRaw: getAttributeValue(listElement, "data-gtm-list-index"),
      listGtmId: getAttributeValue(listElement, "data-gtm-id"),
      raw
    };
  }

  function getSectionInfo(card, metadata = getCardMetadata(card)) {
    const element =
      metadata.listElement ||
      findListContainerByCardListName(card, metadata.cardListName) ||
      findSectionElement(card) ||
      document.body;
    const listName = metadata.listName || metadata.cardListName || "";
    const listIndexRaw = metadata.listIndexRaw || "";
    const gtmId = metadata.listGtmId || "";
    const mappedTitle = titleFromListName(listName);
    const title = mappedTitle || findSectionTitle(element, card) || inferSectionLabel(getVisibleRect(card));

    return {
      key: listName || `${getDomPath(element)}:${title}`,
      element,
      title,
      listName,
      listIndexRaw,
      gtmId,
      sectionIndex: deriveSectionIndex(listName, listIndexRaw)
    };
  }

  function deriveSectionIndex(listName, listIndexRaw) {
    if (listName === "List_ALL_HOT_PICKS") {
      return 1;
    }

    const sectionIndex = normalizeListIndex(listIndexRaw);
    if (sectionIndex == null) {
      return null;
    }

    return derivePageType(location.href) === "home" ? sectionIndex + 1 : sectionIndex;
  }

  function findClosestWithAnyAttribute(element, attributeNames, maxDepth) {
    let current = element instanceof Element ? element : null;

    for (let depth = 0; current && current !== document.documentElement && depth < maxDepth; depth += 1) {
      if (attributeNames.some((attribute) => current.hasAttribute(attribute))) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function findListContainerByCardListName(card, listName) {
    if (!card || !listName) {
      return null;
    }

    let current = card.parentElement;
    let best = null;

    for (let depth = 0; current && current !== document.body && depth < 12; depth += 1) {
      if (countCardsForListName(current, listName) >= 2) {
        best = current;
      }

      current = current.parentElement;
    }

    return best;
  }

  function countCardsForListName(root, listName) {
    return Array.from(root.querySelectorAll?.("[data-gtm-card-list-name]") || [])
      .filter((element) => element.getAttribute("data-gtm-card-list-name") === listName)
      .length;
  }

  function getAttributeValue(element, attributeName) {
    return element?.getAttribute?.(attributeName) || "";
  }

  function splitLabels(value) {
    return value
      ? value.split(",").map((label) => label.trim()).filter(Boolean)
      : [];
  }

  function normalizeGtmIndex(value, metadata = {}) {
    if (value === "" || value == null) {
      return null;
    }

    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      return null;
    }

    const indexBase = inferGtmIndexBase(metadata);
    return indexBase === 0 ? number + 1 : number || null;
  }

  function inferGtmIndexBase(metadata) {
    const listName = metadata?.listName || metadata?.cardListName || "";
    const listGtmId = metadata?.listGtmId || "";

    if (listGtmId === "ad-list" || listName.includes("_ADLIST_")) {
      return 1;
    }

    return 0;
  }

  function normalizeListIndex(value) {
    if (value === "" || value == null) {
      return null;
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }

    return number + 1;
  }

  function getUsefulGtmItemId(itemId) {
    if (!itemId || itemId === "ad-list-card") {
      return "";
    }

    return itemId;
  }

  function deriveContentType(contentHref) {
    if (!contentHref) {
      return "";
    }

    try {
      const parsedUrl = new URL(contentHref);
      const pathname = parsedUrl.pathname;
      const hostname = parsedUrl.hostname.toLowerCase();

      if (hostname.endsWith("fanloop.com")) {
        return "fanloop";
      }

      if (pathname.includes("/video/")) {
        return "video";
      }

      if (pathname.includes("/live-channels/")) {
        return "live_channel";
      }

      if (pathname.includes("/themes/")) {
        return "theme";
      }

      if (pathname.includes("/ed-says/")) {
        return "article";
      }

      if (pathname.includes("/search/list")) {
        return "category";
      }

      if (pathname.includes("/events/")) {
        return "promotion";
      }

      return "other";
    } catch (_error) {
      return "";
    }
  }

  function derivePageType(url) {
    try {
      const path = new URL(url, location.href).pathname;
      const localePart = "(?:/[a-z]{2})";

      if (new RegExp(`^${localePart}/?$`).test(path)) return "home";
      if (new RegExp(`^${localePart}/home/?$`).test(path)) return "home";
      if (new RegExp(`^${localePart}/video/`).test(path)) return "item";
      if (new RegExp(`^${localePart}/live-channels/`).test(path)) return "live_channel";
      if (new RegExp(`^${localePart}/themes/`).test(path)) return "theme";
      if (new RegExp(`^${localePart}/search/person/`).test(path)) return "person";
      if (new RegExp(`^${localePart}/search/list`).test(path)) return "search_list";
      if (new RegExp(`^${localePart}/tab/`).test(path)) return "tab";
      if (new RegExp(`^${localePart}/ed-says`).test(path)) return "editorial";
      if (new RegExp(`^${localePart}/(plan-intro|info/)`).test(path)) return "info";

      return "other";
    } catch (_error) {
      return "other";
    }
  }

  function derivePageContextId(url) {
    try {
      const u = new URL(url, location.href);
      const path = u.pathname;
      const idMatch = path.match(/^\/[a-z]{2}\/(?:video|live-channels|themes|search\/person|tab)\/([^\/?#]+)/);

      if (idMatch) {
        return idMatch[1];
      }

      if (/^\/[a-z]{2}\/search\/list/.test(path)) {
        return u.searchParams.get("args") || "";
      }

      return "";
    } catch (_error) {
      return "";
    }
  }

  function titleFromListName(listName) {
    const mapping = {
      List_ALL_HOT_PICKS: "Hero",
      "List_ALL_DEFAULT#ALL#LIVE_TV": "CATCHPLAY TV 熱播",
      "List_ALL_PREMIUM#ALL#LIVE_TV": "CATCHPLAY TV 熱播",
      "List_ALL_BASIC#ALL#LIVE_TV": "CATCHPLAY TV 熱播",
      "List_ALL_DEFAULT#ALL#NEW_ARRIVAL_ALLBRAND": "最新上架",
      "List_ALL_BASIC#ALL#NEW_ARRIVAL_ALLBRAND": "最新上架",
      "List_ALL_DEFAULT#ALL#TOP_RANKING": "本週 Top 10",
      "List_ALL_BASIC#ALL#TOP_RANKING": "本週 Top 10",
      "List_ALL_DEFAULT#ALL#MOST_POPULAR_ALLBRAND": "熱度飆升",
      "List_ALL_BASIC#ALL#MOST_POPULAR_ALLBRAND": "熱度飆升",
      "List_ALL_DEFAULT#ALL#CP_FREE_MOVIE": "CP+電影免費看",
      "List_ALL_BASIC#ALL#CP_FREE_MOVIE": "CP+電影免費看",
      "List_ALL_DEFAULT#ALL#CP_FREE_SERIES": "CP+影集首集免費看",
      "List_ALL_BASIC#ALL#CP_FREE_SERIES": "CP+影集首集免費看",
      "List_ALL_BASIC#ALL#EDITORPICKS_3": "戲院看不到的好片",
      "List_ALL_BASIC#ALL#EDITORPICKS_5": "向經典致敬",
      List_ALL_BEHAVIOR_RECOMMEND: "推薦給你",
      List_ALL_DISCOVER_NEW: "更多專屬內容",
      List_ALL_ADLIST_adlist: "大家都愛看",
      List_ALL_ADLIST_adliste: "編輯私房推薦",
      List_ALL_ADLIST_thematicadlist: "特別推薦",
      List_ALL_ADLIST_portraitadlist: "影音快遞",
      List_ALL_ARTICLES: "編看編談"
    };

    return mapping[listName] || "";
  }

  function findCardElements(root) {
    const candidates = new Set();

    root.querySelectorAll?.("[data-gtm-card-item-id], [data-gtm-card-item-name]").forEach((element) => {
      const anchor = findAnchor(element) || element.querySelector?.("a[href]");
      const card = anchor || element;
      if (card && isReasonableCard(card)) {
        candidates.add(card);
      }
    });

    root.querySelectorAll?.("a[href]").forEach((anchor) => {
      if (hasMediaSignal(anchor)) {
        candidates.add(anchor);
      }
    });

    root.querySelectorAll?.("img").forEach((image) => {
      if (!isPosterLikeImage(image)) {
        return;
      }

      const card = findAnchor(image) || findCardContainer(image);
      if (card && isReasonableCard(card)) {
        candidates.add(card);
      }
    });

    root.querySelectorAll?.("[style*='background'], [role='link'], [role='button']").forEach((element) => {
      if (!hasBackgroundImage(element)) {
        return;
      }

      const rect = getVisibleRect(element);
      if (rect.width >= 70 && rect.height >= 50) {
        candidates.add(findAnchor(element) || findCardContainer(element) || element);
      }
    });

    return Array.from(candidates)
      .filter(isReasonableCard)
      .filter(isFeedbackTargetCard);
  }

  function isFeedbackTargetCard(card) {
    if (isInExcludedListName(card)) {
      return false;
    }

    const contentHref = normalizeUrl(findAnchor(card)?.getAttribute("href") || "");
    const contentType = deriveContentType(contentHref);
    return ["video", "live_channel", "theme", "article", "fanloop"].includes(contentType);
  }

  function isInExcludedListName(card) {
    if (!card) {
      return false;
    }

    const direct = card.getAttribute?.("data-gtm-card-list-name");
    if (direct && NON_RECOMMENDATION_LIST_NAMES.has(direct)) {
      return true;
    }

    const ancestor = card.closest?.("[data-gtm-card-list-name]");
    const ancestorName = ancestor?.getAttribute?.("data-gtm-card-list-name");
    return Boolean(ancestorName && NON_RECOMMENDATION_LIST_NAMES.has(ancestorName));
  }

  function hasMediaSignal(element) {
    const images = Array.from(element.querySelectorAll?.("img,picture img") || []);
    if (images.some(isPosterLikeImage)) {
      return true;
    }

    const backgroundElement = findBackgroundImageElement(element);
    const rect = getVisibleRect(backgroundElement || element);
    return Boolean(backgroundElement && rect.width >= 70 && rect.height >= 50);
  }

  function isPosterLikeImage(image) {
    const rect = image.getBoundingClientRect();
    const source = getPosterUrl(image);

    if (!source || source.startsWith("data:")) {
      return false;
    }

    if (rect.width < 60 || rect.height < 45) {
      return false;
    }

    if (rect.width > window.innerWidth * 0.95 || rect.height > window.innerHeight * 0.95) {
      return false;
    }

    const ratio = rect.height / Math.max(rect.width, 1);
    return ratio >= 0.42 && ratio <= 2.7;
  }

  function isReasonableCard(element) {
    const rect = getVisibleRect(element);

    if (rect.width < 60 || rect.height < 45) {
      return false;
    }

    if (rect.width > window.innerWidth * 0.98 || rect.height > window.innerHeight * 1.3) {
      return false;
    }

    return true;
  }

  function getVisibleRect(element) {
    const ownRect = element?.getBoundingClientRect?.();
    if (isUsableRect(ownRect)) {
      return ownRect;
    }

    const poster = findBestPoster(element);
    const posterRect = poster?.getBoundingClientRect?.();
    if (isUsableRect(posterRect)) {
      return posterRect;
    }

    const backgroundElement = findBackgroundImageElement(element);
    const backgroundRect = backgroundElement?.getBoundingClientRect?.();
    if (isUsableRect(backgroundRect)) {
      return backgroundRect;
    }

    let current = element?.parentElement || null;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const rect = current.getBoundingClientRect();
      if (isUsableRect(rect) && rect.width < window.innerWidth * 0.98) {
        return rect;
      }
      current = current.parentElement;
    }

    return ownRect || new DOMRect(0, 0, 0, 0);
  }

  function isUsableRect(rect) {
    return Boolean(rect && rect.width >= 20 && rect.height >= 20);
  }

  function findAnchor(element) {
    return element?.closest?.("a[href]") || element?.querySelector?.("a[href]") || null;
  }

  function findCardContainer(element) {
    let current = element.parentElement;
    const baseRect = element.getBoundingClientRect();

    for (let depth = 0; current && depth < 6; depth += 1) {
      const rect = current.getBoundingClientRect();
      const hasClickSignal =
        current.getAttribute("role") === "link" ||
        current.getAttribute("tabindex") === "0" ||
        typeof current.onclick === "function" ||
        current.querySelector("a[href]");

      const sizeLooksRight =
        rect.width >= baseRect.width &&
        rect.width <= baseRect.width * 3.2 &&
        rect.height >= baseRect.height &&
        rect.height <= baseRect.height * 2.4;

      if (hasClickSignal && sizeLooksRight) {
        return current;
      }

      current = current.parentElement;
    }

    return element.parentElement;
  }

  function findBestPoster(card) {
    if (!card) {
      return null;
    }

    const images = Array.from(card.querySelectorAll?.("img") || []);
    return images
      .filter((image) => getPosterUrl(image))
      .sort((a, b) => imageScore(b) - imageScore(a))[0] || null;
  }

  function imageScore(image) {
    const placeholderPenalty = isPlaceholderImage(image) ? -1000000 : 1000000;
    const altBonus = isUsefulTitle(image.getAttribute("alt") || "") ? 10000 : 0;
    return imageArea(image) + placeholderPenalty + altBonus;
  }

  function isPlaceholderImage(image) {
    const url = getPosterUrl(image);
    const alt = (image?.getAttribute("alt") || "").toLowerCase();
    return (
      !url ||
      url.startsWith("data:image/gif") ||
      url.includes("/static/images/live-tv/Mask_") ||
      alt === "mask"
    );
  }

  function findBackgroundImageElement(root) {
    if (!root) {
      return null;
    }

    if (hasBackgroundImage(root)) {
      return root;
    }

    return Array.from(root.querySelectorAll?.("*") || [])
      .filter(hasBackgroundImage)
      .sort((a, b) => rectArea(b.getBoundingClientRect()) - rectArea(a.getBoundingClientRect()))[0] || null;
  }

  function imageArea(image) {
    return rectArea(image.getBoundingClientRect());
  }

  function rectArea(rect) {
    return rect.width * rect.height;
  }

  function getPosterUrl(image) {
    if (!image) {
      return "";
    }

    return (
      image.currentSrc ||
      image.getAttribute("src") ||
      firstSrcsetUrl(image.getAttribute("srcset")) ||
      image.getAttribute("data-src") ||
      image.getAttribute("data-lazy-src") ||
      firstSrcsetUrl(image.getAttribute("data-srcset")) ||
      ""
    );
  }

  function firstSrcsetUrl(srcset) {
    if (!srcset) {
      return "";
    }

    return srcset
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .find(Boolean) || "";
  }

  function hasBackgroundImage(element) {
    const inline = element.getAttribute("style") || "";
    if (/background(?:-image)?\s*:/i.test(inline) && /url\(/i.test(inline)) {
      return true;
    }

    const background = getComputedStyle(element).backgroundImage;
    return Boolean(background && background !== "none" && /url\(/i.test(background));
  }

  function findSectionElement(card) {
    let current = card.parentElement;
    let best = current || card;
    const cardRect = getVisibleRect(card);

    for (let depth = 0; current && depth < 9; depth += 1) {
      const rect = current.getBoundingClientRect();
      const posterCount = countPosterSignals(current, 18);
      const hasHeading = Boolean(findTitleInContainer(current, card, cardRect));

      if (posterCount >= 2 && rect.height <= window.innerHeight * 1.8) {
        best = current;
      }

      if (posterCount >= 2 && hasHeading) {
        return current;
      }

      current = current.parentElement;
    }

    return best;
  }

  function countPosterSignals(root, limit) {
    let count = 0;
    const images = root.querySelectorAll?.("img") || [];

    for (const image of images) {
      if (isPosterLikeImage(image)) {
        count += 1;
      }

      if (count >= limit) {
        break;
      }
    }

    return count;
  }

  function findSectionTitle(section, card) {
    const cardRect = getVisibleRect(card);
    let current = section;

    for (let depth = 0; current && depth < 5; depth += 1) {
      const headings = Array.from(
        current.querySelectorAll("h1,h2,h3,h4,h5,h6,[aria-label]")
      ).filter((element) => {
        if (card.contains(element)) {
          return false;
        }

        const text = getElementLabel(element);
        if (!text || text.length > 80) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.top <= cardRect.top + 20;
      });

      const nearest = headings
        .sort((a, b) => {
          const aDistance = Math.abs(cardRect.top - a.getBoundingClientRect().bottom);
          const bDistance = Math.abs(cardRect.top - b.getBoundingClientRect().bottom);
          return aDistance - bDistance;
        })[0];

      const label = getElementLabel(nearest);
      if (label) {
        return label;
      }

      const nearbyTitle = findTitleInContainer(current, card, cardRect);
      if (nearbyTitle) {
        return nearbyTitle;
      }

      current = current.parentElement;
    }

    return findTitleInContainer(document.body, card, cardRect) || inferSectionLabel(cardRect);
  }

  function findTitleInContainer(container, card, cardRect) {
    if (!container) {
      return "";
    }

    const candidates = Array.from(container.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,p"))
      .filter((element) => {
        if (element === card || card.contains(element) || element.contains(card)) {
          return false;
        }

        if (element.querySelector("img,a[href],button,input,svg")) {
          return false;
        }

        const text = getElementLabel(element);
        if (!isLikelySectionTitle(text)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        if (!isUsableRect(rect) || rect.height > 72 || rect.width > 560) {
          return false;
        }

        const verticalDistance = cardRect.top - rect.bottom;
        if (verticalDistance < -4 || verticalDistance > 280) {
          return false;
        }

        return rangesOverlap(rect.left, rect.right, cardRect.left - 40, cardRect.right + 40);
      });

    const nearest = candidates
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const aDistance = Math.abs(cardRect.top - aRect.bottom);
        const bDistance = Math.abs(cardRect.top - bRect.bottom);
        return aDistance - bDistance;
      })[0];

    return getElementLabel(nearest);
  }

  function isLikelySectionTitle(text) {
    if (!text || text.length < 2 || text.length > 48) {
      return false;
    }

    const blocked = new Set([
      "首頁",
      "頻道",
      "影劇",
      "單租",
      "lite 免費",
      "更多",
      FEEDBACK_QUESTION.toLowerCase(),
      ...FEEDBACK_OPTIONS.map((option) => option.label.toLowerCase())
    ]);

    return !blocked.has(text.toLowerCase());
  }

  function inferSectionLabel(cardRect) {
    if (cardRect.top < Math.max(360, window.innerHeight * 0.55)) {
      return "Hero";
    }

    return "";
  }

  function findContentTitle(card, anchor, poster, preferredTitle = "") {
    const values = [
      preferredTitle,
      anchor?.getAttribute("aria-label"),
      anchor?.getAttribute("title"),
      card.getAttribute("aria-label"),
      card.getAttribute("title"),
      card.innerText,
      poster?.getAttribute("alt")
    ];

    for (const value of values) {
      const text = cleanTitleCandidate(value);
      if (isUsefulTitle(text)) {
        return text;
      }
    }

    return "";
  }

  function cleanTitleCandidate(value) {
    const text = trimText(value || "", 140);
    if (!text) {
      return "";
    }

    const parts = text.split(" ").filter(Boolean);
    while (parts.length && isTitleBadge(parts[0])) {
      parts.shift();
    }

    const cleaned = trimText(parts.join(" "), 140);
    return isTitleBadge(cleaned) ? "" : cleaned;
  }

  function isUsefulTitle(text) {
    if (!text || text.length < 2 || text.length > 140) {
      return false;
    }

    const blocked = new Set(FEEDBACK_OPTIONS.map((option) => option.label.toLowerCase()));
    const normalized = normalizeTitleBadge(text);
    return !blocked.has(text.toLowerCase()) && !TITLE_BADGE_LABELS.has(normalized);
  }

  function isTitleBadge(text) {
    return TITLE_BADGE_LABELS.has(normalizeTitleBadge(text));
  }

  function normalizeTitleBadge(text) {
    return String(text)
      .replace(/^[\s"'「『【[(]+|[\s"'」』】\]).,，、:：!！?？]+$/g, "")
      .trim()
      .toLowerCase();
  }

  function findItemIndex(section, card) {
    if (!section) {
      return null;
    }

    const cards = findCardElements(section);
    const contentHref = normalizeUrl(findAnchor(card)?.getAttribute("href") || "");
    const index = cards.findIndex((candidate) => {
      const candidateHref = normalizeUrl(findAnchor(candidate)?.getAttribute("href") || "");
      return (
        candidate === card ||
        candidate.contains(card) ||
        card.contains(candidate) ||
        Boolean(contentHref && candidateHref === contentHref)
      );
    });

    return index >= 0 ? index + 1 : null;
  }

  function findSectionIndex(section) {
    if (!section) {
      return null;
    }

    const sections = Array.from(new Set(
      Array.from(state.registeredCardElements)
        .map(findSectionElement)
        .concat(Array.from(document.querySelectorAll("section,article,[role='region'],main > div")))
    ))
      .filter((candidate) => candidate && countPosterSignals(candidate, 3) >= 2)
      .sort((a, b) => getVisibleRect(a).top - getVisibleRect(b).top);

    const index = sections.findIndex((candidate) => candidate === section || candidate.contains(section));
    return index >= 0 ? index + 1 : null;
  }

  function getElementLabel(element) {
    if (!element) {
      return "";
    }

    return trimText(
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent ||
      "",
      80
    );
  }

  function getConfidence(fields) {
    const score = [
      fields.contentHref,
      fields.contentTitle,
      fields.posterUrl,
      fields.sectionTitle
    ].filter(Boolean).length;

    if (score >= 3) {
      return "high";
    }

    if (score >= 2) {
      return "medium";
    }

    return "low";
  }

  function deriveContentId(contentHref) {
    if (!contentHref) {
      return "";
    }

    try {
      const url = new URL(contentHref);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeUrl(value) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, location.href).href;
    } catch (_error) {
      return value;
    }
  }

  function trimText(value, limit) {
    const normalized = String(value)
      .replace(/\s+/g, " ")
      .trim();

    if (normalized.length <= limit) {
      return normalized;
    }

    return `${normalized.slice(0, limit - 1)}...`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function rangesOverlap(startA, endA, startB, endB) {
    return startA <= endB && startB <= endA;
  }

  function updateDebugPanel() {
    debugPanel.hidden = !state.enabled || !state.debugMode;
    debugPanel.textContent = `CATCHPLAY MVP: ${state.registeredCardCount} cards detected`;
  }

  function silenceUi() {
    debugPanel.hidden = true;
    document.documentElement.classList.add("cpfb-disabled");
    for (const card of state.registeredCardElements) {
      card.classList.remove("cpfb-debug-card");
      const poster = findBestPoster(card);
      if (poster) {
        poster.classList.remove("cpfb-debug-card");
      }
    }
  }

  function unsilenceUi() {
    document.documentElement.classList.remove("cpfb-disabled");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }
})();
