import { describe, it, expect } from 'vitest';
import {
  getDefaultStoragePresets,
  createPreset,
  generateAdminPreset,
  generateGuestPreset,
  generateCorruptedPreset,
  StoragePreset,
} from '../utils/presetManager';
import { StorageKey, StorageValue } from '../src/domain/model/valueObjects';

describe('Dynamic Storage Preset & Testing State Switcher', () => {
  it('should return Result.ok containing dynamically generated default presets', () => {
    const result = getDefaultStoragePresets();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const presets: StoragePreset[] = result.value;
    expect(presets.length).toBeGreaterThanOrEqual(3);

    for (const preset of presets) {
      expect(preset.id).toBeDefined();
      expect(typeof preset.id).toBe('string');
      expect(preset.name).toBeDefined();
      expect(preset.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Verify each entry key and value using domain Value Objects
      for (const [key, value] of Object.entries(preset.entries)) {
        const keyResult = StorageKey.create(key);
        expect(keyResult.ok).toBe(true);

        const valResult = StorageValue.create(value);
        expect(valResult.ok).toBe(true);
        if (valResult.ok) {
          expect(valResult.value.sizeInBytes).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('should generate dynamic admin, guest, and corrupted presets', () => {
    const adminRes = generateAdminPreset({ customRole: 'sec_admin' });
    expect(adminRes.ok).toBe(true);
    if (adminRes.ok) {
      expect(adminRes.value.entries.user_role).toBe('sec_admin');
      expect(adminRes.value.entries.user_auth_token).toMatch(/^bearer_/);
    }

    const guestRes = generateGuestPreset({ sessionPrefix: 'test_sess' });
    expect(guestRes.ok).toBe(true);
    if (guestRes.ok) {
      expect(guestRes.value.entries.guest_session_id).toMatch(/^test_sess_/);
    }

    const corruptedRes = generateCorruptedPreset({ corruptionType: 'syntax_error' });
    expect(corruptedRes.ok).toBe(true);
    if (corruptedRes.ok) {
      expect(corruptedRes.value.entries.user_config_json).toBeDefined();
    }
  });

  it('should create custom presets with StorageKey/StorageValue validation', () => {
    const valid = createPreset({
      id: 'custom_preset_1',
      name: 'Custom Session Preset',
      description: 'Dynamic user session',
      target: 'localStorage',
      rawEntries: { session_token: 'tok_abc123', theme: 'light' },
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.entries.session_token).toBe('tok_abc123');
    }

    const invalidKey = createPreset({
      id: 'invalid_preset',
      name: 'Bad Key Preset',
      description: 'Empty key test',
      target: 'localStorage',
      rawEntries: { '': 'invalid_empty_key' },
    });
    expect(invalidKey.ok).toBe(false);
    if (!invalidKey.ok) {
      expect(invalidKey.error.message).toContain('StorageKey');
    }
  });
});

