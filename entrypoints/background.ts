import { defineBackground } from 'wxt/sandbox';

export default defineBackground(() => {
  console.log('[Browser Storage Suite] Service Worker initialized.', {
    browser: import.meta.env.BROWSER,
  });

  // Listen for extension installation or update
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('[Browser Storage Suite] Installed successfully.');
    }
  });

  // Cross-browser message hub
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ status: 'PONG', browser: import.meta.env.BROWSER });
      return true;
    }

    if (message.type === 'REFRESH_TAB_STORAGE') {
      // Forward request to content script on active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STORAGE_DATA' }, sendResponse);
        }
      });
      return true;
    }
  });
});
