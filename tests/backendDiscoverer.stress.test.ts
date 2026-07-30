import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NetworkRequestSniffer,
  EnvironmentProber,
  probeBackendEndpointResult,
  discoverBackendEndpointsResult,
  validateApiUrl,
  probeBackendEndpoint,
  getLocalhostDevPorts,
} from '../utils/backendDiscoverer';

describe('M4 Empirical Stress & Adversarial Challenge Suite', () => {
  beforeEach(() => {
    NetworkRequestSniffer.reset();
  });

  it('1. Parallel Backend Discovery Requests: Should handle 50 concurrent discovery requests without race conditions or uncaught errors', async () => {
    const mockOpenApiJson = {
      openapi: '3.0.0',
      paths: { '/api/v1/status': {} },
      components: { schemas: { Status: { type: 'object' } } },
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('8080') && url.includes('openapi.json')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockOpenApiJson,
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' } as Response);
    });

    NetworkRequestSniffer.captureRequestUrl('http://localhost:8080/api');

    const parallelRequests = Array.from({ length: 50 }, (_, i) =>
      discoverBackendEndpointsResult({ API_URL: `http://localhost:${8000 + (i % 5)}` })
    );

    const results = await Promise.all(parallelRequests);

    expect(results).toHaveLength(50);
    for (const res of results) {
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.some((b) => b.baseUrl === 'http://localhost:8080')).toBe(true);
      }
    }
  });

  it('2. Memory Leak & Sniffing Scale: Should process 10,000 distinct request URLs through NetworkRequestSniffer without crashing', () => {
    const startMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < 10000; i++) {
      NetworkRequestSniffer.captureRequestUrl(`http://api-server-${i}.internal:${3000 + (i % 1000)}/v1/endpoint`);
    }

    const origins = NetworkRequestSniffer.getCapturedOrigins();
    const ports = NetworkRequestSniffer.getCapturedPorts();

    expect(origins.length).toBe(10000);
    expect(ports.length).toBe(1000);

    NetworkRequestSniffer.reset();
    expect(NetworkRequestSniffer.getCapturedOrigins().length).toBe(0);

    const endMemory = process.memoryUsage().heapUsed;
    const diffMb = (endMemory - startMemory) / (1024 * 1024);
    // Heap growth should be minimal (< 20MB)
    expect(diffMb).toBeLessThan(20);
  });

  it('3. Robust Handling of Malformed/Massive URLs: Should handle empty, null, invalid, or massive 1MB string URLs', () => {
    const massiveUrl = 'http://example.com/' + 'a'.repeat(1_000_000);

    expect(() => {
      NetworkRequestSniffer.captureRequestUrl(massiveUrl);
      NetworkRequestSniffer.captureRequestUrl(null as any);
      NetworkRequestSniffer.captureRequestUrl(undefined as any);
      NetworkRequestSniffer.captureRequestUrl(12345 as any);
      NetworkRequestSniffer.captureRequestUrl('ftp://invalid-protocol.com');
      NetworkRequestSniffer.captureRequestUrl('not a url at all');
    }).not.toThrow();

    const origins = NetworkRequestSniffer.getCapturedOrigins();
    expect(origins).toContain('http://example.com');
    expect(origins.length).toBe(1);
  });

  it('4. Invalid Storage Objects & Edge Case Probing: EnvironmentProber should safely probe corrupt, non-string, circular, or nested storage objects', () => {
    const circularObj: any = { API_KEY: 'http://localhost:5000' };
    circularObj.self = circularObj;

    const weirdStorage = {
      API_ENDPOINT: 'http://localhost:9000/api',
      NUMERIC_KEY: 12345 as any,
      NULL_KEY: null as any,
      UNDEFINED_KEY: undefined as any,
      OBJ_VALUE: { host: 'http://localhost:7000' } as any,
      ARRAY_VALUE: ['http://localhost:6000'] as any,
      FUNC_VALUE: (() => 'http://localhost:8000') as any,
    };

    expect(() => {
      const candidates1 = EnvironmentProber.probeStorage(weirdStorage);
      expect(candidates1).toContain('http://localhost:9000');

      const candidates2 = EnvironmentProber.probeStorage(null as any);
      expect(candidates2).toEqual([]);

      const candidates3 = EnvironmentProber.probeStorage(undefined as any);
      expect(candidates3).toEqual([]);

      const candidates4 = EnvironmentProber.extractCandidates(weirdStorage, ['invalid-origin', 'https://extra.domain.com:8443']);
      expect(candidates4).toContain('http://localhost:9000');
      expect(candidates4).toContain('https://extra.domain.com:8443');
    }).not.toThrow();
  });

  it('5. Missing Chrome API Degradation: NetworkRequestSniffer.attachListener() should degrade gracefully when chrome API is absent or incomplete', () => {
    const originalChrome = (globalThis as any).chrome;

    // Case 1: chrome is undefined
    (globalThis as any).chrome = undefined;
    expect(NetworkRequestSniffer.attachListener()).toBe(false);

    // Case 2: chrome exists but webRequest is missing
    (globalThis as any).chrome = {};
    expect(NetworkRequestSniffer.attachListener()).toBe(false);

    // Case 3: chrome.webRequest exists but addListener throws
    (globalThis as any).chrome = {
      webRequest: {
        onBeforeRequest: {
          addListener: () => {
            throw new Error('Permission denied in Manifest V3');
          },
        },
      },
    };
    expect(NetworkRequestSniffer.attachListener()).toBe(false);

    // Restore
    (globalThis as any).chrome = originalChrome;
  });
});
