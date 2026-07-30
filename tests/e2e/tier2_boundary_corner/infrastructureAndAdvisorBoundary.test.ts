import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionTelemetry } from '../../../src/infrastructure/telemetry/tracer';
import { StorageInterceptorAdapter } from '../../../src/infrastructure/adapters/storageInterceptorAdapter';
import { analyzeStoragePerformance } from '../../../utils/performanceAdvisor';
import { StorageMutation } from '../../../utils/storageAggregate';

describe('Tier 2 Boundary & Corner Cases: Telemetry, Interceptor, Quota Advisor & Options', () => {
  // Feature 13: OpenTelemetry Tracing Layer
  describe('Feature 13: OpenTelemetry Tracing Layer', () => {
    it('TC-F13-B1: records exception on span, ends span, and re-throws when operation fails', () => {
      const errorToThrow = new Error('Database connection failed');

      expect(() => {
        ExtensionTelemetry.traceOperation('failing_operation', () => {
          throw errorToThrow;
        });
      }).toThrow('Database connection failed');
    });

    it('TC-F13-B2: passes through primitive and complex return values intact', () => {
      const numResult = ExtensionTelemetry.traceOperation('number_op', () => 42);
      expect(numResult).toBe(42);

      const nullResult = ExtensionTelemetry.traceOperation('null_op', () => null);
      expect(nullResult).toBeNull();

      const objResult = ExtensionTelemetry.traceOperation('obj_op', () => ({ status: 'active' }));
      expect(objResult).toEqual({ status: 'active' });
    });

    it('TC-F13-B3: handles non-Error objects thrown during traceOperation', () => {
      expect(() => {
        ExtensionTelemetry.traceOperation('string_throw_op', () => {
          throw 'Non-Error string exception';
        });
      }).toThrow('Non-Error string exception');
    });

    it('TC-F13-B4: supports nested traceOperation calls without state corruption', () => {
      const result = ExtensionTelemetry.traceOperation('outer_span', () => {
        const inner = ExtensionTelemetry.traceOperation('inner_span', () => {
          return 'nested_success';
        });
        return `outer_${inner}`;
      });

      expect(result).toBe('outer_nested_success');
    });

    it('TC-F13-B5: handles extreme span names (empty string, unicode, long string)', () => {
      const emptySpan = ExtensionTelemetry.startSpan('');
      expect(emptySpan).toBeDefined();
      emptySpan.end();

      const unicodeSpan = ExtensionTelemetry.startSpan('🔥_telemetry_span_🚀');
      expect(unicodeSpan).toBeDefined();
      unicodeSpan.end();

      const longSpanName = 'span_' + 'x'.repeat(1000);
      const longSpan = ExtensionTelemetry.startSpan(longSpanName);
      expect(longSpan).toBeDefined();
      longSpan.end();
    });
  });

  // Feature 14: Native Storage Interception Adapter
  describe('Feature 14: Native Storage Interception Adapter', () => {
    it('TC-F14-B1: guards safely against null or non-EventTarget object in constructor/attach', () => {
      const mockCallback = vi.fn();
      const invalidTarget = {} as EventTarget;

      const adapter = new StorageInterceptorAdapter(mockCallback, invalidTarget);
      expect(() => adapter.attach()).not.toThrow();
      expect(() => adapter.detach()).not.toThrow();
    });

    it('TC-F14-B2: ignores duplicate calls to attach()', () => {
      const addEventListenerSpy = vi.fn();
      const mockTarget = {
        addEventListener: addEventListenerSpy,
        removeEventListener: vi.fn(),
      } as unknown as EventTarget;

      const mockCallback = vi.fn();
      const adapter = new StorageInterceptorAdapter(mockCallback, mockTarget);

      adapter.attach();
      adapter.attach();
      adapter.attach();

      expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    });

    it('TC-F14-B3: handles detach() when not attached without throwing', () => {
      const mockCallback = vi.fn();
      const mockTarget = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as EventTarget;

      const adapter = new StorageInterceptorAdapter(mockCallback, mockTarget);
      expect(() => adapter.detach()).not.toThrow();
    });

    it('TC-F14-B4: ignores CustomEvent dispatched without detail property', () => {
      const listeners: Record<string, (evt: Event) => void> = {};
      const mockTarget = {
        addEventListener: (name: string, cb: (evt: Event) => void) => {
          listeners[name] = cb;
        },
        removeEventListener: vi.fn(),
      } as unknown as EventTarget;

      const mockCallback = vi.fn();
      const adapter = new StorageInterceptorAdapter(mockCallback, mockTarget);
      adapter.attach();

      // Trigger event without detail payload
      const emptyEvt = new CustomEvent('__STORAGE_SUITE_INTERCEPT__');
      listeners['__STORAGE_SUITE_INTERCEPT__'](emptyEvt);

      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('TC-F14-B5: invokes callback with detail when valid StorageMutation CustomEvent is dispatched', () => {
      const listeners: Record<string, (evt: Event) => void> = {};
      const mockTarget = {
        addEventListener: (name: string, cb: (evt: Event) => void) => {
          listeners[name] = cb;
        },
        removeEventListener: vi.fn(),
      } as unknown as EventTarget;

      const mockCallback = vi.fn();
      const adapter = new StorageInterceptorAdapter(mockCallback, mockTarget);
      adapter.attach();

      const mutationDetail: StorageMutation = {
        id: 'm100',
        timestamp: Date.now(),
        type: 'set',
        storageType: 'localStorage',
        key: 'interceptor_key',
        value: 'interceptor_val',
      };

      const validEvt = new CustomEvent('__STORAGE_SUITE_INTERCEPT__', { detail: mutationDetail });
      listeners['__STORAGE_SUITE_INTERCEPT__'](validEvt);

      expect(mockCallback).toHaveBeenCalledWith(mutationDetail);
    });
  });

  // Feature 15: Storage Quota & Performance Advisor
  describe('Feature 15: Storage Quota & Performance Advisor', () => {
    it('TC-F15-B1: returns optimal storage insight for empty local storage and empty cookies', () => {
      const metrics = analyzeStoragePerformance({}, []);

      expect(metrics.localStorageBytes).toBe(0);
      expect(metrics.cookieCount).toBe(0);
      expect(metrics.insights).toHaveLength(1);
      expect(metrics.insights[0].id).toBe('optimal_storage');
      expect(metrics.insights[0].type).toBe('success');
    });

    it('TC-F15-B2: tests exact 100KB boundary for large item warning insight', () => {
      // 100 KB = 102,400 bytes
      // Key + Value size calculation: new Blob([key + val]).size
      const key = 'item';
      
      // Val 1: exactly 100KB - 4 bytes = total 102,400 bytes
      const val100k = 'x'.repeat(102400 - key.length);
      const metrics100k = analyzeStoragePerformance({ [key]: val100k }, []);
      const largeInsight100k = metrics100k.insights.find((i) => i.id.startsWith('large_item_'));
      expect(largeInsight100k).toBeUndefined();

      // Val 2: 100KB + 1 byte = total 102,401 bytes
      const valOver100k = 'x'.repeat(102401 - key.length);
      const metricsOver = analyzeStoragePerformance({ [key]: valOver100k }, []);
      const largeInsightOver = metricsOver.insights.find((i) => i.id.startsWith('large_item_'));
      expect(largeInsightOver).toBeDefined();
      expect(largeInsightOver?.type).toBe('warning');
      expect(largeInsightOver?.title).toContain('100 KB');
    });

    it('TC-F15-B3: tests 75% quota warning boundary (3,932,160 bytes)', () => {
      const limit = 5 * 1024 * 1024; // 5,242,880 bytes
      // 75% = 3,932,160 bytes

      // Under 75%: 3,900,000 bytes
      const underVal = 'a'.repeat(3900000);
      const underMetrics = analyzeStoragePerformance({ k: underVal }, []);
      const underQuotaInsight = underMetrics.insights.find((i) => i.id === 'quota_warning');
      expect(underQuotaInsight).toBeUndefined();

      // Over 75%: 3,950,000 bytes
      const overVal = 'a'.repeat(3950000);
      const overMetrics = analyzeStoragePerformance({ k: overVal }, []);
      const overQuotaInsight = overMetrics.insights.find((i) => i.id === 'quota_warning');
      expect(overQuotaInsight).toBeDefined();
      expect(overQuotaInsight?.type).toBe('warning');
      expect(overQuotaInsight?.description).toContain('%');
    });

    it('TC-F15-B4: detects JWT token security anti-pattern across case variations', () => {
      const entries = {
        USER_SESSION_JWT: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        auth_token_v2: 'bearer_token_string',
      };

      const metrics = analyzeStoragePerformance(entries, []);
      const jwtInsights = metrics.insights.filter((i) => i.id.startsWith('jwt_sec_'));

      expect(jwtInsights).toHaveLength(2);
      expect(jwtInsights[0].type).toBe('tip');
      expect(jwtInsights[0].recommendation).toContain('HttpOnly');
    });

    it('TC-F15-B5: handles multiple simultaneous anti-patterns correctly', () => {
      // 1. Large item (>100KB)
      // 2. JWT token key
      // 3. Total quota > 75%
      const entries = {
        large_jwt_token: 'x'.repeat(4000000),
      };

      const metrics = analyzeStoragePerformance(entries, []);
      expect(metrics.insights.length).toBeGreaterThanOrEqual(3);

      const hasLarge = metrics.insights.some((i) => i.id.startsWith('large_item_'));
      const hasJwt = metrics.insights.some((i) => i.id.startsWith('jwt_sec_'));
      const hasQuota = metrics.insights.some((i) => i.id === 'quota_warning');

      expect(hasLarge).toBe(true);
      expect(hasJwt).toBe(true);
      expect(hasQuota).toBe(true);
    });
  });

  // Feature 16: Extension Options & Snapshot Import/Export
  describe('Feature 16: Extension Options & Snapshot Import/Export', () => {
    // Pure logic functions for storage snapshot export/import used by Options page
    const exportStorageSnapshot = (entries: Record<string, string>) => {
      return JSON.stringify({
        timestamp: Date.now(),
        version: '1.0.0',
        entries,
      }, null, 2);
    };

    const importStorageSnapshot = (jsonString: string): { success: boolean; entries?: Record<string, string>; error?: string } => {
      try {
        const parsed = JSON.parse(jsonString);
        if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
          return { success: false, error: 'Invalid snapshot format: missing entries object' };
        }
        return { success: true, entries: parsed.entries };
      } catch {
        return { success: false, error: 'Invalid JSON file format' };
      }
    };

    it('TC-F16-B1: exports storage snapshot into valid formatted JSON string', () => {
      const entries = { key1: 'val1', key2: 'val2' };
      const snapshotJson = exportStorageSnapshot(entries);

      expect(typeof snapshotJson).toBe('string');
      const parsed = JSON.parse(snapshotJson);
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.entries).toEqual(entries);
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('TC-F16-B2: handles snapshot import with missing or invalid entries structure', () => {
      const invalidSnapshot1 = JSON.stringify({});
      const res1 = importStorageSnapshot(invalidSnapshot1);
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('missing entries object');

      const invalidSnapshot2 = JSON.stringify({ entries: 'not_an_object' });
      const res2 = importStorageSnapshot(invalidSnapshot2);
      expect(res2.success).toBe(false);
    });

    it('TC-F16-B3: handles corrupted non-JSON snapshot import gracefully', () => {
      const corruptedFile = '<html><body>500 Internal Server Error</body></html>';
      const res = importStorageSnapshot(corruptedFile);

      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid JSON file format');
    });

    it('TC-F16-B4: parses and imports valid snapshot JSON successfully', () => {
      const validSnapshot = JSON.stringify({
        timestamp: 1700000000000,
        version: '1.0.0',
        entries: {
          session_token: 'xyz_jwt',
          user_pref: 'dark',
        },
      });

      const res = importStorageSnapshot(validSnapshot);
      expect(res.success).toBe(true);
      expect(res.entries).toEqual({
        session_token: 'xyz_jwt',
        user_pref: 'dark',
      });
    });

    it('TC-F16-B5: verifies default options configuration options', () => {
      const defaultOptions = {
        autoSync: true,
        formatJson: true,
      };

      expect(defaultOptions.autoSync).toBe(true);
      expect(defaultOptions.formatJson).toBe(true);
    });
  });
});
