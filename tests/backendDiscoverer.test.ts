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
  classifySpecType,
  safeFetchSpec,
} from '../utils/backendDiscoverer';

describe('Backend API & Swagger OpenAPI Auto-Discovery Engine', () => {
  beforeEach(() => {
    NetworkRequestSniffer.reset();
  });

  it('should list captured development ports for localhost scanning', () => {
    NetworkRequestSniffer.captureRequestUrl('http://localhost:3000/api');
    NetworkRequestSniffer.captureRequestUrl('http://localhost:8080/api');
    const ports = getLocalhostDevPorts();
    expect(ports).toContain(3000);
    expect(ports).toContain(8080);
  });

  it('should list standard OpenAPI/Swagger spec paths', () => {
    const paths = getStandardApiSpecPaths();
    expect(paths).toContain('/swagger.json');
    expect(paths).toContain('/v3/api-docs');
    expect(paths).toContain('/openapi.json');
    expect(paths).toContain('/graphql');
  });

  it('should construct strongly-typed BackendDiscoveryError instances', () => {
    const err = BackendDiscoveryError.networkError('Connection refused');
    expect(err.kind).toBe('NETWORK_ERROR');
    expect(err.message).toBe('Connection refused');

    const invalidUrlErr = BackendDiscoveryError.invalidUrl('not-a-url');
    expect(invalidUrlErr.kind).toBe('INVALID_URL');
  });

  it('should dynamically capture network request origins and ports via NetworkRequestSniffer', () => {
    NetworkRequestSniffer.captureRequestUrl('http://localhost:9876/api/v1/health');
    NetworkRequestSniffer.captureRequestUrl('https://api.example.com:8443/v2/items');

    const origins = NetworkRequestSniffer.getCapturedOrigins();
    expect(origins).toContain('http://localhost:9876');
    expect(origins).toContain('https://api.example.com:8443');

    const ports = NetworkRequestSniffer.getCapturedPorts();
    expect(ports).toContain(9876);
    expect(ports).toContain(8443);
  });

  it('should probe and parse an active OpenAPI spec JSON response', async () => {
    const mockOpenApiJson = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/users': {},
        '/api/v1/orders': {},
      },
      components: {
        schemas: {
          User: { type: 'object' },
          Order: { type: 'object' },
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenApiJson,
    } as Response);

    const result = await probeBackendEndpoint('http://localhost:8080');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe('openapi');
      expect(result.schemasCount).toBe(2);
      expect(result.endpointsFound).toContain('/api/v1/users');
    }
  });

  it('should validate API base URLs with Result<T, E> handling without throwing', () => {
    const valid = validateApiUrl('http://localhost:8080/api');
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.origin).toBe('http://localhost:8080');
    }

    const invalid = validateApiUrl('ht!!://invalid-url');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.kind).toBe('INVALID_URL');
    }
  });

  it('should probe storage keys and environment maps for candidate API origins', () => {
    const mockStorage = {
      API_BASE_URL: 'http://localhost:4000',
      REACT_APP_BACKEND: 'https://backend.service.internal:9090/v1',
      THEME_COLOR: '#ffffff',
      UNRELATED_KEY: 'some-value',
    };

    const candidates = EnvironmentProber.probeStorage(mockStorage);
    expect(candidates).toContain('http://localhost:4000');
    expect(candidates).toContain('https://backend.service.internal:9090');
    expect(candidates).not.toContain('#ffffff');
  });

  it('should probe endpoint using probeBackendEndpointResult and return Result.ok on success', async () => {
    const mockOpenApiJson = {
      openapi: '3.0.0',
      paths: { '/api/v1/health': {} },
      components: { schemas: { Health: { type: 'object' } } },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOpenApiJson,
    } as Response);

    const res = await probeBackendEndpointResult('http://localhost:8080');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.baseUrl).toBe('http://localhost:8080');
      expect(res.value.type).toBe('openapi');
      expect(res.value.endpointsFound).toContain('/api/v1/health');
    }
  });

  it('should return Result.err(NO_SPEC_FOUND) without throwing when no endpoints respond', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    const res = await probeBackendEndpointResult('http://localhost:9999');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('NO_SPEC_FOUND');
    }
  });

  it('should dynamically include captured network ports in getLocalhostDevPorts()', () => {
    NetworkRequestSniffer.captureRequestUrl('http://localhost:9876/api/v1');
    const ports = getLocalhostDevPorts();
    expect(ports).toContain(9876);
  });

  it('should run end-to-end backend discovery across storage and sniffed origins using discoverBackendEndpointsResult', async () => {
    NetworkRequestSniffer.captureRequestUrl('http://localhost:8080/api');
    const storageMap = { API_URL: 'http://localhost:5000' };

    const mockOpenApiJson = {
      openapi: '3.0.0',
      paths: { '/api/v1/items': {} },
      components: { schemas: { Item: { type: 'object' } } },
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

    const result = await discoverBackendEndpointsResult(storageMap);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThanOrEqual(1);
      const found8080 = result.value.find((b) => b.baseUrl === 'http://localhost:8080');
      expect(found8080).toBeDefined();
      expect(found8080?.type).toBe('openapi');
    }
  });
});


