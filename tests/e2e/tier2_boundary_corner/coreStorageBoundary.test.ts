import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getActiveTab, getCookiesForTab, deleteCookie, CookieItem } from '../../../utils/browserApi';
import { StorageStateAggregate, StorageMutation } from '../../../utils/storageAggregate';

describe('Tier 2 Boundary & Corner Cases: Core Storage', () => {
  // Feature 1: Live Storage Inspector (Boundary & Corner Cases)
  describe('Feature 1: Live Storage Inspector', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('TC-F1-B1: handles undefined or empty tab URL gracefully', async () => {
      const globalChrome = {
        cookies: {
          getAll: vi.fn(),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const resultUndefined = await getCookiesForTab(undefined);
      expect(resultUndefined).toEqual([]);

      const resultEmpty = await getCookiesForTab('');
      expect(resultEmpty).toEqual([]);
      expect(globalChrome.cookies.getAll).not.toHaveBeenCalled();
    });

    it('TC-F1-B2: handles tab query when chrome.tabs.query returns empty array', async () => {
      const globalChrome = {
        tabs: {
          query: vi.fn().mockResolvedValue([]),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const tab = await getActiveTab();
      expect(tab).toBeUndefined();
      expect(globalChrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    });

    it('TC-F1-B3: handles restricted browser protocols (chrome://, about:blank) throwing permission error', async () => {
      const globalChrome = {
        cookies: {
          getAll: vi.fn().mockRejectedValue(new Error('Cannot access chrome:// URL')),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cookies = await getCookiesForTab('chrome://settings');
      
      expect(cookies).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('Error fetching cookies:', expect.any(Error));
    });

    it('TC-F1-B4: handles tabs with extreme length URLs and special characters', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2000) + '?query=special%20chars%26%3D';
      const mockCookie = {
        name: 'session_id',
        value: 'val_123',
        domain: 'example.com',
        path: '/',
        secure: true,
        httpOnly: true,
      };

      const globalChrome = {
        cookies: {
          getAll: vi.fn().mockResolvedValue([mockCookie]),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const cookies = await getCookiesForTab(longUrl);
      expect(cookies).toHaveLength(1);
      expect(cookies[0].name).toBe('session_id');
      expect(globalChrome.cookies.getAll).toHaveBeenCalledWith({ url: longUrl });
    });

    it('TC-F1-B5: handles tab storage payload with nullish or missing properties', async () => {
      const globalChrome = {
        cookies: {
          getAll: vi.fn().mockResolvedValue([
            { name: 'incomplete', value: '', domain: '', path: '', secure: false, httpOnly: false },
          ]),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const cookies = await getCookiesForTab('https://example.com');
      expect(cookies).toHaveLength(1);
      expect(cookies[0].expirationDate).toBeUndefined();
      expect(cookies[0].value).toBe('');
    });
  });

  // Feature 2: Cookie Manager (Boundary & Corner Cases)
  describe('Feature 2: Cookie Manager', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('TC-F2-B1: handles malformed URL format when getting cookies', async () => {
      const globalChrome = {
        cookies: {
          getAll: vi.fn().mockRejectedValue(new Error('Invalid URL')),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cookies = await getCookiesForTab('not-a-valid-url');

      expect(cookies).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('TC-F2-B2: handles deleting non-existent cookie safely', async () => {
      const globalChrome = {
        cookies: {
          remove: vi.fn().mockResolvedValue(null),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const success = await deleteCookie('https://example.com', 'non_existent_cookie');
      expect(success).toBe(true);
      expect(globalChrome.cookies.remove).toHaveBeenCalledWith({
        url: 'https://example.com',
        name: 'non_existent_cookie',
      });
    });

    it('TC-F2-B3: returns false when cookie deletion throws chrome runtime error', async () => {
      const globalChrome = {
        cookies: {
          remove: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const success = await deleteCookie('https://protected.domain.com', 'auth_cookie');

      expect(success).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to remove cookie:', expect.any(Error));
    });

    it('TC-F2-B4: maps cookie items with boundary expiration dates (epoch 0, max integer)', async () => {
      const rawCookies = [
        { name: 'session', value: '1', domain: '.test.com', path: '/', secure: true, httpOnly: true, expirationDate: 0 },
        { name: 'forever', value: '2', domain: '.test.com', path: '/', secure: true, httpOnly: true, expirationDate: 2147483647 },
      ];

      const globalChrome = {
        cookies: {
          getAll: vi.fn().mockResolvedValue(rawCookies),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const cookies = await getCookiesForTab('https://test.com');
      expect(cookies).toHaveLength(2);
      expect(cookies[0].expirationDate).toBe(0);
      expect(cookies[1].expirationDate).toBe(2147483647);
    });

    it('TC-F2-B5: handles empty string cookie name and empty URL deletion attempts', async () => {
      const globalChrome = {
        cookies: {
          remove: vi.fn().mockResolvedValue({ url: '', name: '' }),
        },
      };
      vi.stubGlobal('chrome', globalChrome);

      const result = await deleteCookie('', '');
      expect(result).toBe(true);
      expect(globalChrome.cookies.remove).toHaveBeenCalledWith({ url: '', name: '' });
    });
  });

  // Feature 3: Storage State Aggregate & Time Travel (Boundary & Corner Cases)
  describe('Feature 3: Storage State Aggregate & Time Travel', () => {
    it('TC-F3-B1: rejects mutation with missing key for set and delete operations', () => {
      const aggregate = new StorageStateAggregate();

      const invalidSet: StorageMutation = {
        id: 'm1',
        timestamp: 1000,
        type: 'set',
        storageType: 'localStorage',
        key: '',
        value: 'val1',
      };

      const invalidDelete: StorageMutation = {
        id: 'm2',
        timestamp: 2000,
        type: 'delete',
        storageType: 'localStorage',
        key: '',
      };

      const resSet = aggregate.applyMutation(invalidSet);
      expect(resSet.ok).toBe(false);
      if (!resSet.ok) {
        expect(resSet.error.type).toBe('INVALID_MUTATION');
        expect(resSet.error.message).toContain('Key is required');
      }

      const resDelete = aggregate.applyMutation(invalidDelete);
      expect(resDelete.ok).toBe(false);
      if (!resDelete.ok) {
        expect(resDelete.error.type).toBe('INVALID_MUTATION');
      }
    });

    it('TC-F3-B2: returns SNAPSHOT_NOT_FOUND error when requesting snapshot from empty aggregate', () => {
      const aggregate = new StorageStateAggregate();

      const snapshotRes = aggregate.getSnapshotAt(5000);
      expect(snapshotRes.ok).toBe(false);
      if (!snapshotRes.ok) {
        expect(snapshotRes.error.type).toBe('SNAPSHOT_NOT_FOUND');
        expect(snapshotRes.error.timestamp).toBe(5000);
      }
    });

    it('TC-F3-B3: handles out-of-order time travel timestamps deterministically', () => {
      const aggregate = new StorageStateAggregate();

      // Insert mutations out of chronological order
      aggregate.applyMutation({
        id: 'm3',
        timestamp: 3000,
        type: 'set',
        storageType: 'localStorage',
        key: 'k1',
        value: 'v_at_3000',
      });

      aggregate.applyMutation({
        id: 'm1',
        timestamp: 1000,
        type: 'set',
        storageType: 'localStorage',
        key: 'k1',
        value: 'v_at_1000',
      });

      aggregate.applyMutation({
        id: 'm2',
        timestamp: 2000,
        type: 'set',
        storageType: 'localStorage',
        key: 'k2',
        value: 'v_at_2000',
      });

      // Verify historical snapshot at t=1500ms
      const snap1500 = aggregate.getSnapshotAt(1500);
      expect(snap1500.ok).toBe(true);
      if (snap1500.ok) {
        expect(snap1500.value.entries).toEqual({ k1: 'v_at_1000' });
      }

      // Verify historical snapshot at t=2500ms
      const snap2500 = aggregate.getSnapshotAt(2500);
      expect(snap2500.ok).toBe(true);
      if (snap2500.ok) {
        expect(snap2500.value.entries).toEqual({ k1: 'v_at_1000', k2: 'v_at_2000' });
      }

      // Verify historical snapshot at t=3500ms
      const snap3500 = aggregate.getSnapshotAt(3500);
      expect(snap3500.ok).toBe(true);
      if (snap3500.ok) {
        expect(snap3500.value.entries).toEqual({ k1: 'v_at_3000', k2: 'v_at_2000' });
      }
    });

    it('TC-F3-B4: handles extreme timestamps (negative, zero, Number.MAX_SAFE_INTEGER)', () => {
      const aggregate = new StorageStateAggregate();

      aggregate.applyMutation({
        id: 'm_neg',
        timestamp: -100,
        type: 'set',
        storageType: 'localStorage',
        key: 'ancient_key',
        value: 'ancient_value',
      });

      aggregate.applyMutation({
        id: 'm_zero',
        timestamp: 0,
        type: 'set',
        storageType: 'localStorage',
        key: 'epoch_key',
        value: 'epoch_value',
      });

      aggregate.applyMutation({
        id: 'm_max',
        timestamp: Number.MAX_SAFE_INTEGER,
        type: 'set',
        storageType: 'localStorage',
        key: 'future_key',
        value: 'future_value',
      });

      const snapNeg = aggregate.getSnapshotAt(-50);
      expect(snapNeg.ok).toBe(true);
      if (snapNeg.ok) {
        expect(snapNeg.value.entries).toEqual({ ancient_key: 'ancient_value' });
      }

      const snapMax = aggregate.getSnapshotAt(Number.MAX_SAFE_INTEGER);
      expect(snapMax.ok).toBe(true);
      if (snapMax.ok) {
        expect(snapMax.value.entries).toEqual({
          ancient_key: 'ancient_value',
          epoch_key: 'epoch_value',
          future_key: 'future_value',
        });
      }
    });

    it('TC-F3-B5: handles clear mutation and verifies total timeline deletion behavior', () => {
      const aggregate = new StorageStateAggregate();

      aggregate.applyMutation({
        id: 'm1',
        timestamp: 100,
        type: 'set',
        storageType: 'localStorage',
        key: 'k1',
        value: 'v1',
      });

      aggregate.applyMutation({
        id: 'm2',
        timestamp: 200,
        type: 'set',
        storageType: 'localStorage',
        key: 'k2',
        value: 'v2',
      });

      aggregate.applyMutation({
        id: 'm3',
        timestamp: 300,
        type: 'clear',
        storageType: 'localStorage',
        key: '',
      });

      aggregate.applyMutation({
        id: 'm4',
        timestamp: 400,
        type: 'set',
        storageType: 'localStorage',
        key: 'k3',
        value: 'v3',
      });

      // At t=250: should have k1, k2
      const snap250 = aggregate.getSnapshotAt(250);
      expect(snap250.ok && snap250.value.entries).toEqual({ k1: 'v1', k2: 'v2' });

      // At t=350: clear was applied, entries empty
      const snap350 = aggregate.getSnapshotAt(350);
      expect(snap350.ok && snap350.value.entries).toEqual({});

      // At t=450: only k3 should exist
      const snap450 = aggregate.getSnapshotAt(450);
      expect(snap450.ok && snap450.value.entries).toEqual({ k3: 'v3' });
    });
  });
});
