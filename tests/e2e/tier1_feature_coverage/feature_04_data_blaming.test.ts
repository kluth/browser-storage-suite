import { describe, it, expect, beforeEach } from 'vitest';
import { getStorageDataBlame, DataBlameRegistry } from '../../../utils/dataBlamer';

describe('Feature 04: Data Blaming & Callstack Attribution', () => {
  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
  });

  it('4.1 should attribute authentication token mutations dynamically from script callstack', () => {
    const authStack = `Error
    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)
    at async handleLogin (https://example.com/static/js/login.ts:45:3)`;

    DataBlameRegistry.getInstance().recordMutation('user_auth_token', 'bearer_old_token_expired_123', authStack);
    const blame = getStorageDataBlame('user_auth_token', 'bearer_xyz_123', authStack);

    expect(blame.key).toBe('user_auth_token');
    expect(blame.actor.name).toContain('setAuthToken');
    expect(blame.actor.type).toBe('script');
    expect(blame.actor.scriptUrl).toContain('auth-bundle.js');
    expect(blame.actor.stackTraceSnippet).toContain('handleLogin');
    expect(blame.revisionCount).toBe(2);
    expect(blame.previousValue).toBe('bearer_old_token_expired_123');
  });

  it('4.2 should attribute theme/preference keys to user action when callstack contains user event', () => {
    const userEventStack = `Error
    at toggleDarkMode (https://example.com/assets/theme-switch.js:12:5)
    at HTMLButtonElement.onClick (https://example.com/assets/theme-switch.js:5:10)`;

    DataBlameRegistry.getInstance().recordMutation('ui_theme_pref', 'light_mode', userEventStack);
    const blame = getStorageDataBlame('ui_theme_pref', 'dark_mode', userEventStack);

    expect(blame.key).toBe('ui_theme_pref');
    expect(blame.actor.name).toContain('User Action');
    expect(blame.actor.type).toBe('user_action');
    expect(blame.actor.scriptUrl).toContain('theme-switch.js');
    expect(blame.actor.stackTraceSnippet).toContain('toggleDarkMode');
    expect(blame.revisionCount).toBe(2);
    expect(blame.previousValue).toBe('light_mode');
  });

  it('4.3 should attribute generic keys dynamically to caller script', () => {
    const appStack = `Error
    at updateState (https://example.com/app.js:88:14)`;

    const blame = getStorageDataBlame('custom_app_setting', 'enabled', appStack);

    expect(blame.key).toBe('custom_app_setting');
    expect(blame.actor.name).toContain('updateState');
    expect(blame.actor.type).toBe('script');
    expect(blame.actor.scriptUrl).toContain('app.js');
    expect(blame.revisionCount).toBe(1);
  });

  it('4.4 should parse stack trace and attribute actors correctly regardless of key casing', () => {
    const authStack = `Error
    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)`;

    const blameUppercase = getStorageDataBlame('JWT_TOKEN', 'token_val', authStack);
    const blameMixed = getStorageDataBlame('Auth_Header', 'header_val', authStack);

    expect(blameUppercase.actor.name).toContain('setAuthToken');
    expect(blameMixed.actor.name).toContain('setAuthToken');
  });

  it('4.5 should return valid ISO timestamp string for lastModifiedAt property', () => {
    const blame = getStorageDataBlame('random_key', 'random_val');

    expect(typeof blame.lastModifiedAt).toBe('string');
    const dateParsed = Date.parse(blame.lastModifiedAt);
    expect(isNaN(dateParsed)).toBe(false);
    expect(dateParsed).toBeLessThanOrEqual(Date.now());
  });

  it('4.6 should structure actor stack trace snippet as multi-line callstack', () => {
    const multiLineStack = `Error
    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)
    at handleLogin (https://example.com/login.js:45:3)`;

    const blame = getStorageDataBlame('access_token', 'xyz', multiLineStack);

    expect(blame.actor.stackTraceSnippet).toBeDefined();
    const lines = blame.actor.stackTraceSnippet!.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('auth-bundle.js');
  });
});
