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

  it('should validate preset id and name boundaries', () => {
    const emptyId = createPreset({
      id: '   ',
      name: 'Valid Name',
      description: 'Desc',
      target: 'localStorage',
      rawEntries: { a: 'b' },
    });
    expect(emptyId.ok).toBe(false);
    if (!emptyId.ok) {
      expect(emptyId.error.message).toBe('Preset id cannot be empty');
    }

    const missingId = createPreset({
      id: '',
      name: 'Valid Name',
      description: 'Desc',
      target: 'localStorage',
      rawEntries: { a: 'b' },
    });
    expect(missingId.ok).toBe(false);
    if (!missingId.ok) {
      expect(missingId.error.message).toBe('Preset id cannot be empty');
    }

    const emptyName = createPreset({
      id: 'p_123',
      name: '  ',
      description: 'Desc',
      target: 'localStorage',
      rawEntries: { a: 'b' },
    });
    expect(emptyName.ok).toBe(false);
    if (!emptyName.ok) {
      expect(emptyName.error.message).toBe('Preset name cannot be empty');
    }

    const missingName = createPreset({
      id: 'p_123',
      name: '',
      description: 'Desc',
      target: 'localStorage',
      rawEntries: { a: 'b' },
    });
    expect(missingName.ok).toBe(false);
    if (!missingName.ok) {
      expect(missingName.error.message).toBe('Preset name cannot be empty');
    }

    const noDesc = createPreset({
      id: 'p_no_desc',
      name: 'No Description Preset',
      description: '',
      target: 'localStorage',
      rawEntries: { foo: 'bar' },
    });
    expect(noDesc.ok).toBe(true);
    if (noDesc.ok) {
      expect(noDesc.value.description).toBe('');
    }
  });

  it('should handle StorageKey validation failure during preset creation', () => {
    const res = createPreset({
      id: 'p_bad_key',
      name: 'Bad Key Preset',
      description: 'Contains empty key',
      target: 'localStorage',
      rawEntries: { '': 'some_value' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain('Invalid StorageKey');
    }
  });

  it('should handle default arguments for admin, guest, and corrupted presets', () => {
    const adminDefault = generateAdminPreset();
    expect(adminDefault.ok).toBe(true);
    if (adminDefault.ok) {
      expect(adminDefault.value.entries.user_role).toBe('super_admin');
      expect(adminDefault.value.entries.user_email).toMatch(/^admin_.*@company\.org$/);
    }

    const guestDefault = generateGuestPreset();
    expect(guestDefault.ok).toBe(true);
    if (guestDefault.ok) {
      expect(guestDefault.value.entries.guest_session_id).toMatch(/^guest_sess_/);
      expect(guestDefault.value.entries.theme_preference).toBe('system_default');
    }

    const corruptedDefault = generateCorruptedPreset();
    expect(corruptedDefault.ok).toBe(true);
    if (corruptedDefault.ok) {
      expect(corruptedDefault.value.name).toContain('json_syntax_error');
    }
  });
});

