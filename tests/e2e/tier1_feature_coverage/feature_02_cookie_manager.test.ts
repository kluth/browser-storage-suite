import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCookiesForTab, deleteCookie, getActiveTab, CookieItem } from '../../../utils/browserApi';

describe('Feature 02: Cookie Manager', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockImplementation((queryObj, cb) => {
          const tabs = [{ id: 1, url: 'https://example.com/app', active: true, currentWindow: true }];
          if (cb) cb(tabs);
          return Promise.resolve(tabs);
        }),
      },
      cookies: {
        getAll: vi.fn().mockImplementation(({ url }) => {
          if (!url) return Promise.resolve([]);
          return Promise.resolve([
            {
              name: 'session_id',
              value: 'cookie_val_123',
              domain: 'example.com',
              path: '/',
              secure: true,
              httpOnly: true,
              expirationDate: 1750000000,
            },
            {
              name: 'theme_cookie',
              value: 'dark',
              domain: 'example.com',
              path: '/',
              secure: false,
              httpOnly: false,
            },
          ]);
        }),
        remove: vi.fn().mockImplementation(({ url, name }) => {
          if (url && name) return Promise.resolve({ url, name });
          return Promise.reject(new Error('Invalid arguments'));
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('2.1 should return empty array when URL is undefined or empty', async () => {
    const cookies1 = await getCookiesForTab(undefined);
    expect(cookies1).toEqual([]);

    const cookies2 = await getCookiesForTab('');
    expect(cookies2).toEqual([]);
  });

  it('2.2 should fetch active tab and retrieve formatted cookies', async () => {
    const activeTab = await getActiveTab();
    expect(activeTab).toBeDefined();
    expect(activeTab?.url).toBe('https://example.com/app');

    const cookies = await getCookiesForTab(activeTab?.url);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toEqual<CookieItem>({
      name: 'session_id',
      value: 'cookie_val_123',
      domain: 'example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: 1750000000,
    });
  });

  it('2.3 should delete a cookie by URL and name successfully', async () => {
    const success = await deleteCookie('https://example.com', 'session_id');
    expect(success).toBe(true);
    expect(chrome.cookies.remove).toHaveBeenCalledWith({
      url: 'https://example.com',
      name: 'session_id',
    });
  });

  it('2.4 should handle errors gracefully when chrome.cookies.getAll fails', async () => {
    vi.stubGlobal('chrome', {
      cookies: {
        getAll: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });

    const cookies = await getCookiesForTab('https://example.com');
    expect(cookies).toEqual([]);
  });

  it('2.5 should handle failure gracefully when deleteCookie throws an error', async () => {
    vi.stubGlobal('chrome', {
      cookies: {
        remove: vi.fn().mockRejectedValue(new Error('Cookie write disabled')),
      },
    });

    const result = await deleteCookie('https://example.com', 'non_existent');
    expect(result).toBe(false);
  });

  it('2.6 should parse secure and httpOnly flags accurately from cookie items', async () => {
    const cookies = await getCookiesForTab('https://example.com');
    const secureHttpOnlyCookie = cookies.find((c) => c.name === 'session_id');
    const plainCookie = cookies.find((c) => c.name === 'theme_cookie');

    expect(secureHttpOnlyCookie?.secure).toBe(true);
    expect(secureHttpOnlyCookie?.httpOnly).toBe(true);

    expect(plainCookie?.secure).toBe(false);
    expect(plainCookie?.httpOnly).toBe(false);
  });
});
