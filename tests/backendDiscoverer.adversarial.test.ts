import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLocalhostDevPorts,
  getStandardApiSpecPaths,
  probeBackendEndpoint,
  probeBackendEndpointResult,
  discoverBackendEndpointsResult,
  BackendDiscoveryError,
  NetworkRequestSniffer,
  validateApiUrl,
  EnvironmentProber,
  safeFetchSpec,
  classifySpecType,
  extractEndpointsAndSchemas,
} from '../utils/backendDiscoverer';

describe('Adversarial & Stress Test Suite: backendDiscoverer.ts', () => {
  beforeEach(() => {
    NetworkRequestSniffer.reset();
    vi.restoreAllMocks();
  });

  describe('1. Malformed & Adversarial URL Handling (Zero Throws Guarantee)', () => {
    const invalidUrlStrings = [
      '',
      '   ',
      'not-a-url',
      'ftp://localhost:8080',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<h1>hack</h1>',
      'ssh://git@github.com:user/repo.git',
      'https://',
      '://invalid',
      'http://[invalid-ipv6]:8080',
    ];

    it.each(invalidUrlStrings)(
      'validateApiUrl("%s") must return Result.err without throwing',
      (input) => {
        expect(() => {
          const res = validateApiUrl(input);
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.error.kind).toBe('INVALID_URL');
          }
        }).not.toThrow();
      }
    );

    it.each(invalidUrlStrings)(
      'probeBackendEndpointResult("%s") must return Result.err without throwing',
      async (input) => {
        await expect((async () => {
          const res = await probeBackendEndpointResult(input);
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.error.kind).toBe('INVALID_URL');
          }
        })()).resolves.not.toThrow();
      }
    );

    it.each(invalidUrlStrings)(
      'probeBackendEndpoint("%s") must return null without throwing',
      async (input) => {
        await expect((async () => {
          const res = await probeBackendEndpoint(input);
          expect(res).toBeNull();
        })()).resolves.not.toThrow();
      }
    );

    it('handles non-string primitives (null, undefined, number, object, symbol) without throwing', async () => {
      const nonStrings = [null, undefined, 12345, {}, [], () => {}];
      for (const val of nonStrings) {
        expect(() => {
          const res = validateApiUrl(val as any);
          expect(res.ok).toBe(false);
          expect(res.error.kind).toBe('INVALID_URL');
        }).not.toThrow();

        const resResult = await probeBackendEndpointResult(val as any);
        expect(resResult.ok).toBe(false);
        expect(resResult.error.kind).toBe('INVALID_URL');

        const probeResult = await probeBackendEndpoint(val as any);
        expect(probeResult).toBeNull();
      }

      const sym = Symbol('url');
      expect(() => {
        const res = validateApiUrl(sym as any);
        expect(res.ok).toBe(false);
        expect(res.error.kind).toBe('INVALID_URL');
      }).not.toThrow();
    });
  });

  describe('2. Network Failures & Exception Injection (Zero Throws Guarantee)', () => {
    it('safeFetchSpec must return Result.err(NETWORK_ERROR) when fetch throws an Error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch: Connection refused'));

      const res = await safeFetchSpec('http://localhost:8080/openapi.json');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('NETWORK_ERROR');
        expect(res.error.message).toContain('Failed to fetch spec');
      }
    });

    it('safeFetchSpec must return Result.err(NETWORK_ERROR) when fetch throws a non-Error object or primitive', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        throw 'String error thrown by network driver';
      });

      const res = await safeFetchSpec('http://localhost:8080/openapi.json');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('NETWORK_ERROR');
      }
    });

    it('safeFetchSpec must return Result.err(INVALID_SPEC_JSON) when res.json() throws a syntax error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as Response);

      const res = await safeFetchSpec('http://localhost:8080/openapi.json');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SPEC_JSON');
        expect(res.error.message).toContain('not a valid JSON object');
      }
    });

    it('safeFetchSpec must return Result.err(INVALID_SPEC_JSON) for JSON array responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [1, 2, 3],
      } as Response);

      const res = await safeFetchSpec('http://localhost:8080/openapi.json');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('INVALID_SPEC_JSON');
      }
    });

    it('probeBackendEndpointResult handles 500 Internal Server Error gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const res = await probeBackendEndpointResult('http://localhost:8080');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.kind).toBe('NO_SPEC_FOUND');
      }
    });
  });

  describe('3. Spec Classification & Exception Vulnerability Audit', () => {
    it('classifySpecType handles valid objects', () => {
      expect(classifySpecType('/graphql', {})).toBe('graphql');
      expect(classifySpecType('/swagger.json', { openapi: '3.0.0' })).toBe('openapi');
      expect(classifySpecType('/swagger.json', { swagger: '2.0' })).toBe('openapi');
      expect(classifySpecType('/api-docs', {})).toBe('rest');
    });

    it('classifySpecType handles null, undefined, primitive, and array json inputs safely without throwing', () => {
      expect(classifySpecType('/api-docs', null as any)).toBe('rest');
      expect(classifySpecType('/api-docs', undefined as any)).toBe('rest');
      expect(classifySpecType('/api-docs', 'string' as any)).toBe('rest');
      expect(classifySpecType('/api-docs', 123 as any)).toBe('rest');
      expect(classifySpecType('/api-docs', [1, 2, 3] as any)).toBe('rest');
    });

    it('extractEndpointsAndSchemas handles corrupt, null, undefined, Symbol, or missing paths/components structures', () => {
      const corruptSpecs = [
        null,
        undefined,
        Symbol('spec'),
        {},
        { paths: null, components: null },
        { paths: 'not-an-object', definitions: 'not-an-object' },
        { paths: { '/users': {} }, components: 'invalid' },
        { paths: { '/users': {} }, components: { schemas: null } },
      ];

      for (const spec of corruptSpecs) {
        expect(() => {
          const extracted = extractEndpointsAndSchemas(spec as any);
          expect(Array.isArray(extracted.endpointsFound)).toBe(true);
          expect(typeof extracted.schemasCount).toBe('number');
        }).not.toThrow();
      }
    });
  });

  describe('4. Rapid Concurrent Requests & Stress Harness', () => {
    it('handles 100 rapid concurrent URL captures without race conditions or memory corruption', () => {
      const urls = Array.from({ length: 100 }, (_, i) => `http://localhost:${3000 + i}/api/v1`);

      expect(() => {
        urls.forEach((url) => NetworkRequestSniffer.captureRequestUrl(url));
      }).not.toThrow();

      const ports = NetworkRequestSniffer.getCapturedPorts();
      expect(ports.length).toBe(100);
      expect(ports).toContain(3000);
      expect(ports).toContain(3099);
    });

    it('handles 50 parallel discoverBackendEndpointsResult calls under async stress', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => ({ openapi: '3.0.0', paths: { '/health': {} } }),
            } as Response);
          }, Math.floor(Math.random() * 10));
        });
      });

      const promises = Array.from({ length: 50 }, (_, i) =>
        discoverBackendEndpointsResult(undefined, [`http://localhost:${7000 + i}`])
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(50);
      results.forEach((res) => {
        expect(res.ok).toBe(true);
      });
    });
  });

  describe('5. Environment Probing Edge Cases', () => {
    it('probeStorage handles null, undefined, Symbol, non-string, or corrupt storage objects', () => {
      expect(EnvironmentProber.probeStorage(undefined)).toEqual([]);
      expect(EnvironmentProber.probeStorage(null as any)).toEqual([]);
      expect(EnvironmentProber.probeStorage(Symbol('test') as any)).toEqual([]);

      const corruptStorage = {
        API_KEY: null as any,
        ENDPOINT_NUM: 12345 as any,
        SYMBOL_VAL: Symbol('api') as any,
        VALID_URL: 'https://backend.dev.local:8443/api',
        MALFORMED: 'http://',
      };

      expect(() => {
        const candidates = EnvironmentProber.probeStorage(corruptStorage);
        expect(candidates).toContain('https://backend.dev.local:8443');
      }).not.toThrow();
    });

    it('extractCandidates aggregates origins from Sniffer, Storage, and extraOrigins without duplicates', () => {
      NetworkRequestSniffer.captureRequestUrl('http://localhost:8080/v1');
      const storage = { API_URL: 'http://localhost:8080/v2' };
      const extra = ['http://localhost:8080', 'https://api.external.com:9000'];

      const candidates = EnvironmentProber.extractCandidates(storage, extra);
      expect(candidates).toContain('http://localhost:8080');
      expect(candidates).toContain('https://api.external.com:9000');
      const count8080 = candidates.filter((c) => c === 'http://localhost:8080').length;
      expect(count8080).toBe(1);
    });

    it('extractCandidates handles null, undefined, or non-array extraOrigins without throwing', () => {
      expect(() => {
        const c1 = EnvironmentProber.extractCandidates(undefined, null as any);
        expect(Array.isArray(c1)).toBe(true);

        const c2 = EnvironmentProber.extractCandidates(undefined, Symbol('extra') as any);
        expect(Array.isArray(c2)).toBe(true);

        const c3 = EnvironmentProber.extractCandidates(undefined, undefined);
        expect(Array.isArray(c3)).toBe(true);
      }).not.toThrow();
    });

    it('discoverBackendEndpointsResult handles null or non-array extraOrigins without throwing', async () => {
      await expect((async () => {
        const res = await discoverBackendEndpointsResult(undefined, null as any);
        expect(res.ok).toBe(true);
      })()).resolves.not.toThrow();
    });
  });

  describe('6. Edge-Case Ports & IPv6 Handling', () => {
    it('handles IPv6 URL origins with explicit ports in NetworkRequestSniffer', () => {
      NetworkRequestSniffer.captureRequestUrl('http://[::1]:8080/api');
      const origins = NetworkRequestSniffer.getCapturedOrigins();
      expect(origins).toContain('http://[::1]:8080');
      const ports = NetworkRequestSniffer.getCapturedPorts();
      expect(ports).toContain(8080);
    });

    it('handles standard http (80) and https (443) default ports when port is omitted', () => {
      NetworkRequestSniffer.captureRequestUrl('http://api.example.com/spec');
      NetworkRequestSniffer.captureRequestUrl('https://secure.example.com/spec');

      const ports = NetworkRequestSniffer.getCapturedPorts();
      expect(ports).toContain(80);
      expect(ports).toContain(443);
    });
  });

  describe('7. Dynamic Port Audit', () => {
    it('verifies getLocalhostDevPorts relies 100% on NetworkRequestSniffer without static hardcoded fallback ports', () => {
      NetworkRequestSniffer.reset();
      const portsBefore = getLocalhostDevPorts();
      expect(portsBefore).toEqual([]);

      NetworkRequestSniffer.captureRequestUrl('http://localhost:8080/api');
      const portsAfter = getLocalhostDevPorts();
      expect(portsAfter).toEqual([8080]);
    });
  });
});
