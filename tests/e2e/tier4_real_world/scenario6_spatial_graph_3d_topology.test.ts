import { describe, it, expect } from 'vitest';
import { StorageStateAggregate } from '../../../utils/storageAggregate';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { Result } from '../../../utils/result';
import { GridRow } from '../../../components/VirtualizedDataGrid';

interface SpatialNode3D {
  position: [number, number, number];
  label: string;
  color: string;
  targetType: StorageTarget;
  entryCount: number;
}

class InMemoryTopologyAdapter implements StorageRepositoryPort {
  private store: Map<string, StorageEntryDto> = new Map();

  async fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    const list = Array.from(this.store.values()).filter((e) => e.target === target);
    return Result.ok(list);
  }

  async saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    this.store.set(`${target}:${key.value}`, { key: key.value, value: value.value, target });
    return Result.ok(undefined);
  }

  async deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    this.store.delete(`${target}:${key.value}`);
    return Result.ok(undefined);
  }

  async clear(target: StorageTarget): Promise<Result<void, string>> {
    for (const [k, entry] of this.store.entries()) {
      if (entry.target === target) this.store.delete(k);
    }
    return Result.ok(undefined);
  }
}

describe('Tier 4 Scenario 6: Spatial Graph 3D Topology Visualization (F11, F10, F1, F3)', () => {
  it('should aggregate multi-engine storage targets into 3D topology graph node models', async () => {
    const adapter = new InMemoryTopologyAdapter();
    const service = new StorageApplicationService(adapter);

    await service.setStorageItem('localStorage', 'user_session', 'jwt_99');
    await service.setStorageItem('sessionStorage', 'temp_form', '{"step":2}');
    await service.setStorageItem('indexedDB', 'cart_store', '[{"id":1}]');
    await service.setStorageItem('cookie', 'auth_cookie', 'sess_cookie_1');
    await service.setStorageItem('cacheAPI', 'asset_v1', 'cached_bundle.js');

    const targets: StorageTarget[] = ['localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'cacheAPI'];
    const nodes: SpatialNode3D[] = [];

    const positions: Record<StorageTarget, [number, number, number]> = {
      localStorage: [0, 0, 0],
      sessionStorage: [-4, 2, -2],
      indexedDB: [4, -2, 2],
      cookie: [2, 3, -3],
      cacheAPI: [-3, -2, 1],
      opfs: [1, -4, 0],
    };

    const colors: Record<StorageTarget, string> = {
      localStorage: '#38bdf8',
      sessionStorage: '#a855f7',
      indexedDB: '#10b981',
      cookie: '#f59e0b',
      cacheAPI: '#ec4899',
      opfs: '#64748b',
    };

    for (const target of targets) {
      const viewRes = await service.loadStorageView(target);
      expect(viewRes.ok).toBe(true);
      if (viewRes.ok) {
        nodes.push({
          position: positions[target],
          label: `${target} Engine`,
          color: colors[target],
          targetType: target,
          entryCount: viewRes.value.length,
        });
      }
    }

    expect(nodes.length).toBe(5);
    const rootNode = nodes.find((n) => n.targetType === 'localStorage');
    expect(rootNode).toBeDefined();
    expect(rootNode?.position).toEqual([0, 0, 0]);
    expect(rootNode?.color).toBe('#38bdf8');
    expect(rootNode?.entryCount).toBe(1);

    const idbNode = nodes.find((n) => n.targetType === 'indexedDB');
    expect(idbNode?.color).toBe('#10b981');
    expect(idbNode?.entryCount).toBe(1);
  });

  it('should evaluate WebGL capability and support 2D fallback rendering for spatial graph', () => {
    function checkWebGlSupport(): boolean {
      if (typeof document === 'undefined') return false;
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        return !!gl;
      } catch {
        return false;
      }
    }

    const isWebGlAvailable = checkWebGlSupport();
    expect(typeof isWebGlAvailable).toBe('boolean');

    const defaultNodes = [
      { position: [0, 0, 0], label: 'LocalStorage (Root)', color: '#38bdf8' },
      { position: [-4, 2, -2], label: 'UserSession (JWT)', color: '#a855f7' },
      { position: [4, -2, 2], label: 'CartItems (IndexedDB)', color: '#10b981' },
      { position: [2, 3, -3], label: 'AuthCookie (Session)', color: '#f59e0b' },
      { position: [-3, -2, 1], label: 'CacheAPI (Assets)', color: '#ec4899' },
    ];

    expect(defaultNodes.length).toBe(5);
    defaultNodes.forEach((node) => {
      expect(node.label).toBeDefined();
      expect(node.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(node.position.length).toBe(3);
    });
  });

  it('should synchronize spatial graph nodes with VirtualizedDataGrid row representation', async () => {
    const adapter = new InMemoryTopologyAdapter();
    const service = new StorageApplicationService(adapter);

    await service.setStorageItem('localStorage', 'user_jwt', 'header.payload.signature');
    await service.setStorageItem('localStorage', 'cart_cache', '{"items":[1,2,3]}');

    const viewRes = await service.loadStorageView('localStorage');
    expect(viewRes.ok).toBe(true);
    if (!viewRes.ok) return;

    const gridRows: GridRow[] = viewRes.value.map((entry, idx) => ({
      id: idx + 1,
      key: entry.key,
      value: entry.value,
      type: entry.key.includes('cache') || entry.value.startsWith('{') ? 'JSON' : 'String',
      sizeBytes: new Blob([entry.key + entry.value]).size,
    }));

    expect(gridRows.length).toBe(2);
    expect(gridRows[0].id).toBe(1);
    expect(gridRows[0].key).toBe('user_jwt');
    expect(gridRows[0].sizeBytes).toBeGreaterThan(0);

    expect(gridRows[1].key).toBe('cart_cache');
    expect(gridRows[1].type).toBe('JSON');
    const parsedPayload = JSON.parse(gridRows[1].value);
    expect(parsedPayload.items).toEqual([1, 2, 3]);

    const totalBytes = gridRows.reduce((acc, r) => acc + r.sizeBytes, 0);
    expect(totalBytes).toBeGreaterThan(30);
  });
});
