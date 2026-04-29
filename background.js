chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "CPF_SUBMIT_FEEDBACK") {
    return false;
  }

  submitFeedback(message.payload)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function submitFeedback(payload) {
  const { endpointUrl } = await chrome.storage.sync.get(["endpointUrl"]);

  if (!endpointUrl) {
    return {
      ok: true,
      skipped: true,
      reason: "No Apps Script endpoint configured."
    };
  }

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 500)
  };
}
