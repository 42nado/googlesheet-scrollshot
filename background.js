const api = typeof browser !== 'undefined' ? browser : chrome;

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture-visible') {
    const maxAttempts = 3;
    const delay = 600;
    let attempt = 0;

    function tryCapture() {
      attempt++;
      // Options-only overload — Firefox rejects an explicit `null` windowId.
      api.tabs.captureVisibleTab({ format: 'png' })
        .then(dataUrl => {
          sendResponse({ dataUrl });
        })
        .catch(err => {
          if (attempt < maxAttempts) {
            setTimeout(tryCapture, delay);
          } else {
            sendResponse({ error: err.message });
          }
        });
    }

    tryCapture();
    return true;
  }

  if (message.action === 'preview') {
    const { dataUrl, filename } = message;
    Promise.resolve(api.storage.local.set({ previewData: { dataUrl, filename } }))
      .then(() => api.tabs.create({ url: api.runtime.getURL('preview.html') }))
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'download') {
    const { dataUrl, filename } = message;
    Promise.resolve(api.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    })).then((downloadId) => sendResponse({ downloadId }));
    return true;
  }
});
