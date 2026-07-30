import { describe, it, expect } from 'vitest';
import { StorageStateAggregate, StorageMutation, StorageSnapshot } from '../../../utils/storageAggregate';
import { StorageApplicationService } from '../../../src/application/storageService';
import { StorageRepositoryPort, StorageEntryDto } from '../../../src/domain/ports/secondary/storageRepositoryPort';
import { StorageKey, StorageValue, StorageTarget } from '../../../src/domain/model/valueObjects';
import { Result } from '../../../utils/result';
import { GridRow } from '../../../components/VirtualizedDataGrid';

class InMemorySnapshotAdapter implements StorageRepositoryPort {
  private store: Map<string, string> = new Map();

  async fetchEntries(target: StorageTarget): Promise<Result<StorageEntryDto[], string>> {
    const list = Array.from(this.store.entries()).map(([k, v]) => ({
      key: k,
      value: v,
      target,
    }));
    return Result.ok(list);
  }

  async saveEntry(target: StorageTarget, key: StorageKey, value: StorageValue): Promise<Result<void, string>> {
    this.store.set(key.value, value.value);
    return Result.ok(undefined);
  }

  async deleteEntry(target: StorageTarget, key: StorageKey): Promise<Result<void, string>> {
    this.store.delete(key.value);
    return Result.ok(undefined);
  }

  async clear(target: StorageTarget): Promise<Result<void, string>> {
    this.store.clear();
    return Result.ok(undefined);
  }
}

describe('Tier 4 Scenario 2: Time-Travel Debugging & State Snapshot Restoration (F3, F10, F12, F16)', () => {
  it('should record state mutations across time and allow time-travel snapshot retrieval', () => {
    const aggregate = new StorageStateAggregate();

    const mutations: StorageMutation[] = [
      { id: 'm1', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'user_id', value: 'usr_123' },
      { id: 'm2', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'cart_items', value: '[{"id":"p1"}]' },
      { id: 'm3', timestamp: 3000, type: 'set', storageType: 'localStorage', key: 'theme', value: 'dark' },
      { id: 'm4', timestamp: 4000, type: 'set', storageType: 'localStorage', key: 'theme', value: 'light' },
      { id: 'm5', timestamp: 5000, type: 'delete', storageType: 'localStorage', key: 'cart_items' },
    ];

    mutations.forEach((m) => aggregate.applyMutation(m));

    const snap1500 = aggregate.getSnapshotAt(1500);
    expect(snap1500.ok).toBe(true);
    if (snap1500.ok) {
      expect(snap1500.value.entries['user_id']).toBe('usr_123');
      expect(snap1500.value.entries['cart_items']).toBeUndefined();
    }

    const snap2500 = aggregate.getSnapshotAt(2500);
    expect(snap2500.ok).toBe(true);
    if (snap2500.ok) {
      expect(snap2500.value.entries['user_id']).toBe('usr_123');
      expect(snap2500.value.entries['cart_items']).toBe('[{"id":"p1"}]');
    }

    const snap3500 = aggregate.getSnapshotAt(3500);
    expect(snap3500.ok).toBe(true);
    if (snap3500.ok) {
      expect(snap3500.value.entries['theme']).toBe('dark');
    }

    const snap5500 = aggregate.getSnapshotAt(5500);
    expect(snap5500.ok).toBe(true);
    if (snap5500.ok) {
      expect(snap5500.value.entries['theme']).toBe('light');
      expect(snap5500.value.entries['cart_items']).toBeUndefined();
    }
  });

  it('should export snapshot state and restore it into Hexagonal StorageApplicationService', async () => {
    const aggregate = new StorageStateAggregate();
    aggregate.applyMutation({ id: 'm1', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'session_token', value: 'tok_abc' });
    aggregate.applyMutation({ id: 'm2', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'ui_density', value: 'compact' });

    const snapshotResult = aggregate.getSnapshotAt(2500);
    expect(snapshotResult.ok).toBe(true);
    if (!snapshotResult.ok) return;

    const exportedSnapshot: StorageSnapshot = snapshotResult.value;
    const backupJson = JSON.stringify(exportedSnapshot);

    const importedSnapshot: StorageSnapshot = JSON.parse(backupJson);
    expect(importedSnapshot.timestamp).toBe(2500);
    expect(importedSnapshot.entries['session_token']).toBe('tok_abc');

    const adapter = new InMemorySnapshotAdapter();
    const service = new StorageApplicationService(adapter);

    for (const [key, value] of Object.entries(importedSnapshot.entries)) {
      const setRes = await service.setStorageItem('localStorage', key, value);
      expect(setRes.ok).toBe(true);
    }

    const viewRes = await service.loadStorageView('localStorage');
    expect(viewRes.ok).toBe(true);
    if (viewRes.ok) {
      expect(viewRes.value.length).toBe(2);
      const keys = viewRes.value.map((e) => e.key);
      expect(keys).toContain('session_token');
      expect(keys).toContain('ui_density');
    }
  });

  it('should format time-travel snapshot entries into VirtualizedDataGrid row representations', () => {
    const rawEntries: Record<string, string> = {
      user_profile: '{"name":"Alice","role":"admin"}',
      secret_key: 'super_secret_value',
      created_at: '1700000000000',
    };

    const rows: GridRow[] = Object.entries(rawEntries).map(([key, value], idx) => ({
      id: idx + 1,
      key,
      value,
      type: key.endsWith('_profile') ? 'JSON' : 'String',
      sizeBytes: new Blob([key + value]).size,
    }));

    expect(rows.length).toBe(3);
    expect(rows[0].key).toBe('user_profile');
    expect(rows[0].type).toBe('JSON');

    const jsonParsed = JSON.parse(rows[0].value);
    expect(jsonParsed.name).toBe('Alice');

    const timestampNum = Number(rows[2].value);
    expect(isNaN(timestampNum)).toBe(false);
    const dateFormatted = new Date(timestampNum).toLocaleString();
    expect(dateFormatted).not.toBe('Invalid Date');
  });

  it('should handle out-of-order mutations and return SNAPSHOT_NOT_FOUND for invalid timestamps', () => {
    const aggregate = new StorageStateAggregate();

    aggregate.applyMutation({ id: 'm2', timestamp: 2000, type: 'set', storageType: 'localStorage', key: 'status', value: 'online' });
    aggregate.applyMutation({ id: 'm1', timestamp: 1000, type: 'set', storageType: 'localStorage', key: 'status', value: 'offline' });

    const snap1500 = aggregate.getSnapshotAt(1500);
    expect(snap1500.ok).toBe(true);
    if (snap1500.ok) {
      expect(snap1500.value.entries['status']).toBe('offline');
    }

    const snap2500 = aggregate.getSnapshotAt(2500);
    expect(snap2500.ok).toBe(true);
    if (snap2500.ok) {
      expect(snap2500.value.entries['status']).toBe('online');
    }

    const emptyAggregate = new StorageStateAggregate();
    const snapErr = emptyAggregate.getSnapshotAt(500);
    expect(snapErr.ok).toBe(false);
    if (!snapErr.ok) {
      expect(snapErr.error.type).toBe('SNAPSHOT_NOT_FOUND');
      expect(snapErr.error.timestamp).toBe(500);
    }
  });
});
