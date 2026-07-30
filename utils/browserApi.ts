/**
 * Cross-Browser Extension API abstraction layer.
 * Standardizes API calls between Chrome (MV3 service workers) and Firefox (Gecko MV3 / MV2).
 */

export interface StorageItem {
  key: string;
  value: string;
  type: 'local' | 'session' | 'cookie' | 'indexedDB';
  domain?: string;
}

export interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

/**
 * Retrieves the active browser tab in the current window.
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Fetches all cookies for the active tab's domain.
 */
export async function getCookiesForTab(url?: string): Promise<CookieItem[]> {
  if (!url) return [];
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate,
    }));
  } catch (err) {
    console.error('Error fetching cookies:', err);
    return [];
  }
}

/**
 * Deletes a cookie by name and url.
 */
export async function deleteCookie(url: string, name: string): Promise<boolean> {
  try {
    await chrome.cookies.remove({ url, name });
    return true;
  } catch (err) {
    console.error('Failed to remove cookie:', err);
    return false;
  }
}
