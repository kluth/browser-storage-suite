import { StorageKey, StorageValue, StorageTarget } from '../src/domain/model/valueObjects';
import { Result } from './result';

export interface StoragePreset {
  id: string;
  name: string;
  description: string;
  target: StorageTarget;
  entries: Record<string, string>;
  createdAt: string;
}

export interface PresetCreateOptions {
  id: string;
  name: string;
  description: string;
  target: StorageTarget;
  rawEntries: Record<string, string>;
}

export function validatePresetEntries(rawEntries: Record<string, string>): Result<Record<string, string>, Error> {
  const validated: Record<string, string> = {};

  for (const [rawKey, rawVal] of Object.entries(rawEntries)) {
    const keyRes = StorageKey.create(rawKey);
    if (!keyRes.ok) {
      return Result.err(new Error(`Invalid StorageKey: ${keyRes.error}`));
    }

    const valRes = StorageValue.create(rawVal);
    if (!valRes.ok) {
      return Result.err(new Error('Invalid StorageValue creation failure'));
    }

    validated[keyRes.value.value] = valRes.value.value;
  }

  return Result.ok(validated);
}

export function createPreset(options: PresetCreateOptions): Result<StoragePreset, Error> {
  if (!options.id || options.id.trim().length === 0) {
    return Result.err(new Error('Preset id cannot be empty'));
  }
  if (!options.name || options.name.trim().length === 0) {
    return Result.err(new Error('Preset name cannot be empty'));
  }

  const entriesRes = validatePresetEntries(options.rawEntries);
  if (!entriesRes.ok) {
    return Result.err(entriesRes.error);
  }

  const preset: StoragePreset = {
    id: options.id.trim(),
    name: options.name.trim(),
    description: options.description || '',
    target: options.target,
    entries: entriesRes.value,
    createdAt: new Date().toISOString(),
  };

  return Result.ok(preset);
}

export function generateAdminPreset(options?: { customRole?: string; userEmail?: string }): Result<StoragePreset, Error> {
  const nonce = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const role = options?.customRole || 'super_admin';
  const email = options?.userEmail || `admin_${nonce}@company.org`;
  const token = `bearer_admin_jwt_${nonce}`;

  return createPreset({
    id: `preset_admin_${nonce}`,
    name: `🔑 Dynamic Admin State (${role})`,
    description: 'Dynamically generated admin state with role claims and active token.',
    target: 'localStorage',
    rawEntries: {
      user_auth_token: token,
      user_role: role,
      theme_preference: 'dark',
      user_email: email,
    },
  });
}

export function generateGuestPreset(options?: { sessionPrefix?: string }): Result<StoragePreset, Error> {
  const prefix = options?.sessionPrefix || 'guest_sess';
  const nonce = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const sessionId = `${prefix}_${nonce}`;

  return createPreset({
    id: `preset_guest_${nonce}`,
    name: '👤 Dynamic Guest Session',
    description: 'Dynamically generated guest session state without authentication tokens.',
    target: 'localStorage',
    rawEntries: {
      guest_session_id: sessionId,
      theme_preference: 'system_default',
    },
  });
}

export function generateCorruptedPreset(options?: { corruptionType?: string }): Result<StoragePreset, Error> {
  const nonce = Date.now().toString(36);
  const type = options?.corruptionType || 'json_syntax_error';
  const badJson = `{ "corrupted_payload_${nonce}": true, missing_quotes_at_end: `;

  return createPreset({
    id: `preset_corrupted_${nonce}`,
    name: `⚠️ Malformed Data Payload (${type})`,
    description: 'Dynamically generated malformed JSON payload for resilience testing.',
    target: 'localStorage',
    rawEntries: {
      user_config_json: badJson,
      auth_token: `EXPIRED_TOKEN_MALFORMED_${nonce}`,
    },
  });
}

export function getDefaultStoragePresets(): Result<StoragePreset[], Error> {
  const adminRes = generateAdminPreset();
  const guestRes = generateGuestPreset();
  const corruptedRes = generateCorruptedPreset();

  if (!adminRes.ok) return Result.err(adminRes.error);
  if (!guestRes.ok) return Result.err(guestRes.error);
  if (!corruptedRes.ok) return Result.err(corruptedRes.error);

  return Result.ok([adminRes.value, guestRes.value, corruptedRes.value]);
}

