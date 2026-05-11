chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture-visible') {
    const maxAttempts = 3;
    const delay = 600;
    let attempt = 0;

    function tryCapture() {
      attempt++;
      chrome.tabs.captureVisibleTab(null, { format: 'png' })
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
    chrome.storage.local.set({ previewData: { dataUrl, filename } }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'download') {
    const { dataUrl, filename } = message;
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      sendResponse({ downloadId });
    });
    return true;
  }
});
