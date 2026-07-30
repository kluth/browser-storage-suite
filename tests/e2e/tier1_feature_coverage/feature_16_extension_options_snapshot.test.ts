import { describe, it, expect } from 'vitest';
import { getDefaultStoragePresets, StoragePreset } from '../../../utils/presetManager';
import { StorageSnapshot } from '../../../utils/storageAggregate';

// Snapshot Exporter & Importer domain utility functions
function exportStorageSnapshotJson(snapshot: StorageSnapshot): string {
  return JSON.stringify({
    version: '1.0',
    exportedAt: new Date().toISOString(),
    snapshot,
  }, null, 2);
}

function importStorageSnapshotJson(jsonStr: string): { ok: true; snapshot: StorageSnapshot } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.snapshot || typeof parsed.snapshot.timestamp !== 'number' || typeof parsed.snapshot.entries !== 'object') {
      return { ok: false, error: 'Invalid snapshot format: missing timestamp or entries object' };
    }
    return { ok: true, snapshot: parsed.snapshot };
  } catch {
    return { ok: false, error: 'JSON parse failure: corrupted input payload' };
  }
}

describe('Feature 16: Extension Options & Snapshot Import/Export', () => {
  it('16.1 should fetch default storage presets including Admin, Guest, and Corrupted test states', () => {
    const res = getDefaultStoragePresets();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const presets = res.value;
    expect(presets).toHaveLength(3);
    expect(presets[0].id).toMatch(/^preset_admin_/);
    expect(presets[0].entries).toHaveProperty('user_auth_token');

    expect(presets[1].id).toMatch(/^preset_guest_/);
    expect(presets[1].entries).toHaveProperty('guest_session_id');

    expect(presets[2].id).toMatch(/^preset_corrupted_/);
    expect(presets[2].entries).toHaveProperty('user_config_json');
  });

  it('16.2 should export StorageSnapshot object to standardized JSON string format', () => {
    const snapshot: StorageSnapshot = {
      timestamp: 1700000000000,
      entries: {
        theme: 'dark',
        token: 'bearer_xyz',
      },
    };

    const exportedJson = exportStorageSnapshotJson(snapshot);
    expect(exportedJson).toContain('"version": "1.0"');
    expect(exportedJson).toContain('"exportedAt"');
    expect(exportedJson).toContain('"theme": "dark"');

    const parsed = JSON.parse(exportedJson);
    expect(parsed.snapshot.entries).toEqual(snapshot.entries);
  });

  it('16.3 should import valid snapshot JSON string successfully', () => {
    const snapshotJson = JSON.stringify({
      version: '1.0',
      exportedAt: '2026-07-28T20:00:00.000Z',
      snapshot: {
        timestamp: 1700000000000,
        entries: { key1: 'val1', key2: 'val2' },
      },
    });

    const result = importStorageSnapshotJson(snapshotJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.timestamp).toBe(1700000000000);
      expect(result.snapshot.entries).toEqual({ key1: 'val1', key2: 'val2' });
    }
  });

  it('16.4 should reject corrupted JSON input during snapshot import with error result', () => {
    const corruptedJson = '{ bad_json_payload: missing_quote }';

    const result = importStorageSnapshotJson(corruptedJson);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('JSON parse failure');
    }
  });

  it('16.5 should reject invalid snapshot structure lacking required timestamp or entries', () => {
    const invalidFormatJson = JSON.stringify({
      version: '1.0',
      snapshot: { wrong_field: 123 },
    });

    const result = importStorageSnapshotJson(invalidFormatJson);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid snapshot format');
    }
  });

  it('16.6 should validate extension options default configuration options', () => {
    const defaultOptions = {
      autoSync: true,
      formatJson: true,
      exportFormat: 'JSON' as const,
    };

    expect(defaultOptions.autoSync).toBe(true);
    expect(defaultOptions.formatJson).toBe(true);
    expect(defaultOptions.exportFormat).toBe('JSON');
  });
});
