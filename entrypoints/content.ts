import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('[Browser Storage Suite] Content script active on:', window.location.href);

    // Listen for storage queries from the popup or background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_STORAGE_DATA') {
        const local: Record<string, string> = {};
        const session: Record<string, string> = {};

        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) local[key] = localStorage.getItem(key) || '';
          }
        } catch (e) {
          console.warn('Unable to read localStorage:', e);
        }

        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key) session[key] = sessionStorage.getItem(key) || '';
          }
        } catch (e) {
          console.warn('Unable to read sessionStorage:', e);
        }

        sendResponse({
          url: window.location.href,
          localStorage: local,
          sessionStorage: session,
        });
        return true;
      }

      if (message.type === 'SET_LOCAL_STORAGE') {
        try {
          localStorage.setItem(message.key, message.value);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
        return true;
      }

      if (message.type === 'DELETE_LOCAL_STORAGE') {
        try {
          localStorage.removeItem(message.key);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
        return true;
      }

      if (message.type === 'CLEAR_ALL_LOCAL_STORAGE') {
        try {
          localStorage.clear();
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: String(err) });
        }
        return true;
      }
    });
  },
});
