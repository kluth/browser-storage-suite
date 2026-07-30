import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLocalhostDevPorts,
  getStandardApiSpecPaths,
  probeBackendEndpoint,
  NetworkRequestSniffer,
} from '../../../utils/backendDiscoverer';

describe('Feature 05: Backend API Scanner', () => {
  beforeEach(() => {
    NetworkRequestSniffer.reset();
    NetworkRequestSniffer.captureRequestUrl('http://localhost:3000/api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    NetworkRequestSniffer.reset();
  });

  it('5.1 should provide standard localhost development ports array', () => {
    [3000, 8080, 5173, 8000, 5000].forEach((port) => {
      NetworkRequestSniffer.captureRequestUrl(`http://localhost:${port}/api`);
    });
    const ports = getLocalhostDevPorts();
    expect(ports).toBeInstanceOf(Array);
    expect(ports).toContain(3000);
    expect(ports).toContain(8080);
    expect(ports).toContain(5173);
    expect(ports.length).toBeGreaterThanOrEqual(5);
  });

  it('5.2 should provide standard API spec documentation endpoint paths', () => {
    const paths = getStandardApiSpecPaths();
    expect(paths).toBeInstanceOf(Array);
    expect(paths).toContain('/swagger.json');
    expect(paths).toContain('/openapi.json');
    expect(paths).toContain('/graphql');
  });

  it('5.3 should discover OpenAPI spec endpoint and parse schemas & routes count', async () => {
    const mockOpenApiJson = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {
        '/users': { get: {} },
        '/auth/login': { post: {} },
      },
      components: {
        schemas: {
          UserDto: { type: 'object' },
          AuthResponse: { type: 'object' },
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/openapi.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOpenApiJson),
        });
      }
      return Promise.resolve({ ok: false });
    }));

    const result = await probeBackendEndpoint('http://localhost:3000');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.baseUrl).toBe('http://localhost:3000');
      expect(result.type).toBe('openapi');
      expect(result.specUrl).toBe('http://localhost:3000/openapi.json');
      expect(result.endpointsFound).toEqual(['/users', '/auth/login']);
      expect(result.schemasCount).toBe(2);
    }
  });

  it('5.4 should categorize GraphQL spec endpoint correctly when /graphql path responds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/graphql')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { __schema: { types: [] } } }),
        });
      }
      return Promise.resolve({ ok: false });
    }));

    const result = await probeBackendEndpoint('http://localhost:4000');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe('graphql');
      expect(result.specUrl).toBe('http://localhost:4000/graphql');
    }
  });

  it('5.5 should return null cleanly when all probed spec paths fail or throw connection errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error / Connection refused')));

    const result = await probeBackendEndpoint('http://localhost:9999');
    expect(result).toBeNull();
  });

  it('5.6 should strip trailing slash from baseUrl when probing endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === 'http://localhost:8080/swagger.json') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ swagger: '2.0', paths: {} }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeBackendEndpoint('http://localhost:8080/');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.baseUrl).toBe('http://localhost:8080/');
      expect(result.specUrl).toBe('http://localhost:8080/swagger.json');
    }
  });
});
