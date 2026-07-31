import { describe, it, expect } from 'vitest';
import {
  generateStorageExportBundle,
  generateStandaloneMockServer,
  MockServerOptions,
} from '../utils/mockServerGenerator';

describe('Standalone Mock Server & Storage Bundle Generator', () => {
  it('should generate valid StorageExportBundle with domain and storage data', () => {
    const bundle = generateStorageExportBundle(
      'example.com',
      {
        localStorage: { token: 'bearer_123', theme: 'dark' },
        sessionStorage: { session_id: 'sess_abc' },
        cookies: { auth_cookie: 'xyz' },
        indexedDB: { db1: { count: 5 } },
      },
      [{ id: 'p1', name: 'Preset 1' }],
      {
        baseUrl: 'http://localhost:3000',
        type: 'openapi',
        specUrl: 'http://localhost:3000/docs',
        endpointsFound: ['/api/v1/users'],
        schemasCount: 3,
      }
    );

    expect(bundle.domain).toBe('example.com');
    expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(bundle.storage.localStorage.token).toBe('bearer_123');
    expect(bundle.presets.length).toBe(1);
    expect(bundle.discoveredBackend?.endpointsFound).toContain('/api/v1/users');
  });

  it('should handle default fallbacks for export bundle when parameters are empty', () => {
    const bundle = generateStorageExportBundle('', {
      localStorage: {},
      sessionStorage: {},
      cookies: {},
      indexedDB: {},
    });

    expect(bundle.domain).toBe('localhost');
    expect(bundle.presets).toEqual([]);
    expect(bundle.provenanceHistory).toEqual([]);
  });

  it('should generate standalone mock server code, packageJson, and readme correctly', () => {
    const options: MockServerOptions = {
      port: 8080,
      domain: 'shop.example.com',
      storageData: {
        localStorage: { cart_id: 'cart_999' },
        sessionStorage: {},
        cookies: {},
        indexedDB: {},
      },
      discoveredBackend: {
        baseUrl: 'http://localhost:8080',
        type: 'swagger',
        specUrl: 'http://localhost:8080/swagger.json',
        endpointsFound: ['/api/cart', '/api/checkout'],
        schemasCount: 2,
      },
    };

    const res = generateStandaloneMockServer(options);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const pkg = res.value;
    expect(pkg.filename).toContain('shop_example_com');
    expect(pkg.serverCode).toContain('PORT = process.env.PORT || 8080');
    expect(pkg.serverCode).toContain('/api/cart');
    expect(pkg.serverCode).toContain('Access-Control-Allow-Origin');
    expect(pkg.packageJson).toContain('"name": "browser-storage-mock-server"');
    expect(pkg.readme).toContain('# 🚀 Standalone Development Mock Server (shop.example.com)');
    expect(pkg.exportJson).toContain('"cart_id": "cart_999"');
  });

  it('should handle default options when port and domain are omitted', () => {
    const res = generateStandaloneMockServer({
      storageData: {},
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.filename).toContain('localhost');
    expect(res.value.serverCode).toContain('3000');
  });
});
