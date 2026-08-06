const api = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
  const actions = {
    'btn-screenshot': 'screenshot',
    'btn-area': 'area',
    'btn-scroll': 'tall',
    'btn-selection': 'selection'
  };

  Object.entries(actions).forEach(([btnId, action]) => {
    document.getElementById(btnId).addEventListener('click', async () => {
      try {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;

        try {
          // Try sending message directly (content script may already be loaded)
          await api.tabs.sendMessage(tab.id, { action });
        } catch (e) {
          // Content script not loaded yet — inject it first
          await api.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          await api.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content.css']
          });
          // Wait briefly for script to initialize
          await new Promise(r => setTimeout(r, 100));
          // Retry the message
          await api.tabs.sendMessage(tab.id, { action });
        }
        window.close();
      } catch (err) {
        console.error('Error:', err);
      }
    });
  });
});
