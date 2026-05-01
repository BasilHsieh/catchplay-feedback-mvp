const form = {
  userName: document.querySelector("#userName"),
  endpointUrl: document.querySelector("#endpointUrl"),
  enabled: document.querySelector("#enabled"),
  devMode: document.querySelector("#devMode"),
  devSection: document.querySelector("#devSection"),
  debugMode: document.querySelector("#debugMode"),
  save: document.querySelector("#save"),
  scanPage: document.querySelector("#scanPage"),
  downloadScan: document.querySelector("#downloadScan"),
  status: document.querySelector("#status"),
  scanOutput: document.querySelector("#scanOutput"),
  extensionVersion: document.querySelector("#extensionVersion")
};

let lastScanReport = null;
let statusTimer = 0;

form.extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;

chrome.storage.sync.get(
  {
    userName: "",
    endpointUrl: "",
    enabled: true,
    devMode: false,
    debugMode: false
  },
  (items) => {
    form.userName.value = items.userName;
    form.endpointUrl.value = items.endpointUrl;
    form.enabled.checked = Boolean(items.enabled);
    form.devMode.checked = Boolean(items.devMode);
    form.debugMode.checked = Boolean(items.debugMode);
    form.devSection.hidden = !form.devMode.checked;
  }
);

// Toggles save immediately on change so users don't need to hit "儲存"
form.enabled.addEventListener("change", () => {
  saveSettings(form.enabled.checked ? "Extension 已啟用" : "Extension 已停用");
});

form.devMode.addEventListener("change", () => {
  form.devSection.hidden = !form.devMode.checked;
  saveSettings(form.devMode.checked ? "開發者模式已開" : "開發者模式已關");
});

form.debugMode.addEventListener("change", () => {
  saveSettings(form.debugMode.checked ? "顯示偵測卡片" : "隱藏偵測卡片");
});

form.save.addEventListener("click", () => {
  saveSettings("已儲存");
});

async function saveSettings(statusText) {
  await chrome.storage.sync.set({
    userName: form.userName.value.trim(),
    endpointUrl: form.endpointUrl.value.trim(),
    enabled: form.enabled.checked,
    devMode: form.devMode.checked,
    debugMode: form.debugMode.checked
  });

  form.status.textContent = statusText;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    form.status.textContent = "";
  }, 1800);
}

form.scanPage.addEventListener("click", async () => {
  form.status.textContent = "Scanning current page...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      form.status.textContent = "No active tab found.";
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "CPF_SCAN_PAGE"
    });

    if (!response?.ok) {
      form.status.textContent = response?.error || "Scan failed.";
      return;
    }

    const reportText = JSON.stringify(response.report, null, 2);
    form.scanOutput.value = reportText;
    form.scanOutput.focus();
    form.scanOutput.select();
    lastScanReport = response.report;
    form.downloadScan.disabled = false;

    await copyText(reportText);
    form.status.textContent = "Scan copied. You can also click Download.";
  } catch (error) {
    form.status.textContent = error instanceof Error ? error.message : String(error);
  }
});

form.downloadScan.addEventListener("click", () => {
  const text = form.scanOutput.value;
  if (!text) {
    form.status.textContent = "Run a scan first.";
    return;
  }

  const filename = buildScanFilename(lastScanReport);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  form.status.textContent = `Saved ${filename}`;
});

function buildScanFilename(report) {
  const stamp = formatTimestamp(new Date());
  const slug = pageSlug(report);
  return slug
    ? `catchplay-scan-${slug}-${stamp}.json`
    : `catchplay-scan-${stamp}.json`;
}

function pageSlug(report) {
  if (!report?.pageUrl) {
    return "";
  }

  try {
    const url = new URL(report.pageUrl);
    const path = (url.pathname || "/").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    return path || url.hostname.replace(/[^a-z0-9]+/gi, "-");
  } catch (_error) {
    return "";
  }
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    document.execCommand("copy");
  }
}
