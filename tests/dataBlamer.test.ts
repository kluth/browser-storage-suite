import { describe, it, expect, beforeEach } from 'vitest';
import { getStorageDataBlame, DataBlameRegistry, getStorageDataBlameResult, ScriptOrigin, BlameActor } from '../utils/dataBlamer';

describe('Data Blaming & Storage Provenance Engine (Dynamic Callstack)', () => {
  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
  });

  it('should extract script origin and stack trace from real/synthetic callstacks dynamically', () => {
    const syntheticV8Stack = `Error
    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)
    at async handleLogin (https://example.com/static/js/login.ts:45:3)`;

    const blame = getStorageDataBlame('user_auth_token', 'bearer_new_xyz', syntheticV8Stack);

    expect(blame.key).toBe('user_auth_token');
    expect(blame.actor.name).toContain('setAuthToken');
    expect(blame.actor.scriptUrl).toBe('https://example.com/static/js/auth-bundle.js:L284');
    expect(blame.actor.lineNumber).toBe(284);
    expect(blame.actor.columnNumber).toBe(12);
    expect(blame.actor.stackTraceSnippet).toContain('handleLogin');
    expect(blame.revisionCount).toBe(1);
  });

  it('should parse SpiderMonkey / Firefox stack trace format correctly', () => {
    const firefoxStack = `setAuthToken@https://example.com/static/js/auth-bundle.js:284:12
handleLogin@https://example.com/login.ts:45:3`;

    const blame = getStorageDataBlame('user_auth_token', 'bearer_123', firefoxStack);

    expect(blame.actor.name).toContain('setAuthToken');
    expect(blame.actor.scriptUrl).toBe('https://example.com/static/js/auth-bundle.js:L284');
    expect(blame.actor.lineNumber).toBe(284);
    expect(blame.actor.columnNumber).toBe(12);
  });

  it('should attribute user action events when callstack indicates click or UI handler', () => {
    const userActionStack = `Error
    at toggleDarkMode (https://example.com/assets/theme-switch.js:12:5)
    at HTMLButtonElement.onClick (https://example.com/assets/theme-switch.js:5:10)`;

    const blame = getStorageDataBlame('theme_preference', 'dark', userActionStack);

    expect(blame.actor.type).toBe('user_action');
    expect(blame.actor.name).toContain('User Action');
  });

  it('should attribute extension scripts when stack contains extension protocols', () => {
    const extensionStack = `Error
    at injectScript (chrome-extension://abcdefg/content.js:100:15)`;

    const blame = getStorageDataBlame('extension_key', 'val', extensionStack);

    expect(blame.actor.type).toBe('extension');
    expect(blame.actor.name).toContain('Extension');
  });

  it('should maintain dynamic provenance history for revision count and previous values', () => {
    const registry = DataBlameRegistry.getInstance();
    registry.recordMutation('counter', '1');
    registry.recordMutation('counter', '2');
    registry.recordMutation('counter', '3');

    const blame = getStorageDataBlame('counter', '3');

    expect(blame.revisionCount).toBe(3);
    expect(blame.previousValue).toBe('2');
  });

  it('should handle empty or malformed stack trace without throwing', () => {
    const result = getStorageDataBlameResult('random_key', 'val_123', '');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.key).toBe('random_key');
      expect(result.value.actor.name).toBeDefined();
    }
  });

  it('should instantiate true DDD Value Objects (ScriptOrigin and BlameActor)', () => {
    const syntheticV8Stack = `Error\n    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)`;
    const blame = getStorageDataBlame('user_auth_token', 'bearer_new_xyz', syntheticV8Stack);

    expect(blame.actor).toBeInstanceOf(BlameActor);
    if (blame.actor.origin) {
      expect(blame.actor.origin).toBeInstanceOf(ScriptOrigin);
    }
  });

  it('should parse Windows local file paths in stack traces correctly', () => {
    const windowsStack = `Error\n    at setAuthToken (C:\\Users\\kluth\\Projects\\browser-storage-suite\\auth-bundle.js:284:12)`;
    const blame = getStorageDataBlame('user_auth_token', 'bearer_new_xyz', windowsStack);

    expect(blame.actor.name).toContain('setAuthToken');
    expect(blame.actor.scriptUrl).toContain('C:\\Users\\kluth\\Projects\\browser-storage-suite\\auth-bundle.js');
    expect(blame.actor.lineNumber).toBe(284);
    expect(blame.actor.columnNumber).toBe(12);
  });
});
