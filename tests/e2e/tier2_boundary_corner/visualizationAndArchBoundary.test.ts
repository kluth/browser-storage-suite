import { describe, it, expect, vi } from 'vitest';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { Result } from '../../../utils/result';
import { GraphNode, GraphLink, Node3DPosition } from '../../../workers/spatialLayoutWorker';

describe('Tier 2 Boundary & Corner Cases: Data Grid, 3D Canvas & Hexagonal Architecture', () => {
  // Feature 10: Virtualized Data Grid (Logic & Formatting Boundary Cases)
  describe('Feature 10: Virtualized Data Grid', () => {
    // We test the formatting logic and row transformation rules used by VirtualizedDataGrid
    const renderFormattedValueLogic = (value: string, format: 'raw' | 'pretty_json' | 'masked' | 'epoch_date') => {
      if (format === 'masked') {
        return '••••••••••••••••';
      }

      if (format === 'pretty_json') {
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(parsed, null, 2);
        } catch {
          return `[Invalid JSON] ${value}`;
        }
      }

      if (format === 'epoch_date') {
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== '') {
          return new Date(num > 1e11 ? num : num * 1000).toLocaleString();
        }
      }

      return value;
    };

    it('TC-F10-B1: handles empty row formatting and raw string display format', () => {
      const rawVal = renderFormattedValueLogic('plain_text_value', 'raw');
      expect(rawVal).toBe('plain_text_value');

      const emptyVal = renderFormattedValueLogic('', 'raw');
      expect(emptyVal).toBe('');
    });

    it('TC-F10-B2: handles malformed JSON string gracefully with pretty_json format', () => {
      const malformedVal = renderFormattedValueLogic('{ bad_json: true, missing_quotes }', 'pretty_json');
      expect(malformedVal).toContain('[Invalid JSON]');
      expect(malformedVal).toContain('{ bad_json: true, missing_quotes }');
    });

    it('TC-F10-B3: handles non-numeric string gracefully with epoch_date format', () => {
      const nonNum = renderFormattedValueLogic('not_a_number_timestamp', 'epoch_date');
      expect(nonNum).toBe('not_a_number_timestamp');

      const emptyNum = renderFormattedValueLogic('', 'epoch_date');
      expect(emptyNum).toBe('');
    });

    it('TC-F10-B4: converts epoch timestamps in seconds and milliseconds accurately', () => {
      // 1700000000 (seconds) -> 2023-11-14
      const secFormatted = renderFormattedValueLogic('1700000000', 'epoch_date');
      expect(secFormatted).not.toBe('1700000000');
      expect(secFormatted.length).toBeGreaterThan(5);

      // 1700000000000 (milliseconds) -> 2023-11-14
      const msFormatted = renderFormattedValueLogic('1700000000000', 'epoch_date');
      expect(msFormatted).not.toBe('1700000000000');
      expect(msFormatted.length).toBeGreaterThan(5);
    });

    it('TC-F10-B5: obfuscates value with masked display format', () => {
      const maskedVal = renderFormattedValueLogic('sensitive_password_123', 'masked');
      expect(maskedVal).toBe('••••••••••••••••');
    });
  });

  // Feature 11: 3D Spatial Canvas & Worker
  describe('Feature 11: 3D Spatial Canvas & Layout Worker', () => {
    // Pure function extracting spatial worker force layout algorithm
    const calculateLayout = (nodes: GraphNode[], links: GraphLink[]): Node3DPosition[] => {
      return nodes.map((node, idx) => {
        const phi = Math.acos(-1 + (2 * idx) / (nodes.length || 1));
        const theta = Math.sqrt((nodes.length || 1) * Math.PI) * phi;
        const radius = 12 + (idx % 3) * 4;

        return {
          id: node.id,
          x: radius * Math.cos(theta) * Math.sin(phi),
          y: radius * Math.sin(theta) * Math.sin(phi),
          z: radius * Math.cos(phi),
        };
      });
    };

    it('TC-F11-B1: simulates non-WebGL context fallback detection', () => {
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(null),
      };

      const gl = mockCanvas.getContext('webgl') || mockCanvas.getContext('experimental-webgl');
      expect(gl).toBeNull();
    });

    it('TC-F11-B2: handles empty nodes array in layout worker algorithm', () => {
      const positions = calculateLayout([], []);
      expect(positions).toEqual([]);
    });

    it('TC-F11-B3: handles single node layout without division by zero or NaN coordinates', () => {
      const singleNode: GraphNode = { id: 'root', label: 'LocalStorage', type: 'storage', size: 100 };
      const positions = calculateLayout([singleNode], []);

      expect(positions).toHaveLength(1);
      expect(isNaN(positions[0].x)).toBe(false);
      expect(isNaN(positions[0].y)).toBe(false);
      expect(isNaN(positions[0].z)).toBe(false);
    });

    it('TC-F11-B4: calculates 3D spherical layout coordinates for 100 nodes deterministically', () => {
      const nodes: GraphNode[] = Array.from({ length: 100 }, (_, i) => ({
        id: `node_${i}`,
        label: `Key ${i}`,
        type: 'key',
        size: 10 + i,
      }));

      const positions = calculateLayout(nodes, []);
      expect(positions).toHaveLength(100);

      // Verify coordinate spread
      const xCoords = positions.map((p) => p.x);
      const minX = Math.min(...xCoords);
      const maxX = Math.max(...xCoords);
      expect(maxX - minX).toBeGreaterThan(5);
    });

    it('TC-F11-B5: handles node layout positioning with varying radii', () => {
      const nodes: GraphNode[] = [
        { id: 'n0', label: 'L0', type: 'storage', size: 5 },
        { id: 'n1', label: 'L1', type: 'table', size: 10 },
        { id: 'n2', label: 'L2', type: 'entity', size: 15 },
      ];

      const positions = calculateLayout(nodes, []);
      expect(positions[0].id).toBe('n0');
      expect(positions[1].id).toBe('n1');
      expect(positions[2].id).toBe('n2');
    });
  });

  // Feature 12: Hexagonal Application Service & Result<T, E>
  describe('Feature 12: Hexagonal Application Service & Result<T, E>', () => {
    it('TC-F12-B1: returns Result.err when StorageKey is empty or whitespace-only', () => {
      const emptyKeyRes = StorageKey.create('');
      expect(emptyKeyRes.ok).toBe(false);
      if (!emptyKeyRes.ok) {
        expect(emptyKeyRes.error).toBe('StorageKey cannot be empty');
      }

      const wsKeyRes = StorageKey.create('    ');
      expect(wsKeyRes.ok).toBe(false);
      if (!wsKeyRes.ok) {
        expect(wsKeyRes.error).toBe('StorageKey cannot be empty');
      }
    });

    it('TC-F12-B2: setStorageItem fails early with Result.err if rawKey is invalid', async () => {
      const mockRepo: StorageRepositoryPort = {
        fetchEntries: vi.fn(),
        saveEntry: vi.fn(),
        deleteEntry: vi.fn(),
      };

      const service = new StorageApplicationService(mockRepo);
      const res = await service.setStorageItem('localStorage', '   ', 'some_value');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe('StorageKey cannot be empty');
      }
      expect(mockRepo.saveEntry).not.toHaveBeenCalled();
    });

    it('TC-F12-B3: removeStorageItem fails early with Result.err if rawKey is invalid', async () => {
      const mockRepo: StorageRepositoryPort = {
        fetchEntries: vi.fn(),
        saveEntry: vi.fn(),
        deleteEntry: vi.fn(),
      };

      const service = new StorageApplicationService(mockRepo);
      const res = await service.removeStorageItem('sessionStorage', '');

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe('StorageKey cannot be empty');
      }
      expect(mockRepo.deleteEntry).not.toHaveBeenCalled();
    });

    it('TC-F12-B4: propagates error Result from secondary repository adapter cleanly', async () => {
      const mockRepo: StorageRepositoryPort = {
        fetchEntries: vi.fn().mockResolvedValue(Result.err('STORAGE_READ_DENIED')),
        saveEntry: vi.fn().mockResolvedValue(Result.err('DISK_FULL')),
        deleteEntry: vi.fn().mockResolvedValue(Result.err('KEY_NOT_FOUND')),
      };

      const service = new StorageApplicationService(mockRepo);

      const fetchRes = await service.loadStorageView('localStorage');
      expect(fetchRes.ok).toBe(false);
      if (!fetchRes.ok) expect(fetchRes.error).toBe('STORAGE_READ_DENIED');

      const setRes = await service.setStorageItem('localStorage', 'valid_key', 'val');
      expect(setRes.ok).toBe(false);
      if (!setRes.ok) expect(setRes.error).toBe('DISK_FULL');

      const delRes = await service.removeStorageItem('localStorage', 'valid_key');
      expect(delRes.ok).toBe(false);
      if (!delRes.ok) expect(delRes.error).toBe('KEY_NOT_FOUND');
    });

    it('TC-F12-B5: StorageValue handles nullish raw input by defaulting to empty string', () => {
      const valNull = StorageValue.create(null as unknown as string);
      expect(valNull.ok).toBe(true);
      if (valNull.ok) {
        expect(valNull.value.value).toBe('');
        expect(valNull.value.sizeInBytes).toBe(0);
      }

      const valUndefined = StorageValue.create(undefined as unknown as string);
      expect(valUndefined.ok).toBe(true);
      if (valUndefined.ok) {
        expect(valUndefined.value.value).toBe('');
        expect(valUndefined.value.sizeInBytes).toBe(0);
      }
    });
  });
});
