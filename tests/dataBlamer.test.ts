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
  it('should classify analytics actors from URL or function names', () => {
    const gtagStack = `Error\n    at trackEvent (https://google-analytics.com/gtag.js:10:5)`;
    const blameGtag = getStorageDataBlame('gtag_key', 'val', gtagStack);
    expect(blameGtag.actor.type).toBe('analytics');
    expect(blameGtag.actor.name).toContain('Analytics');

    const funcAnalyticsStack = `Error\n    at sendAnalyticsData (https://example.com/app.js:20:5)`;
    const blameFunc = getStorageDataBlame('analytics_key', 'val', funcAnalyticsStack);
    expect(blameFunc.actor.type).toBe('analytics');
    expect(blameFunc.actor.name).toContain('Analytics');
  });

  it('should classify moz-extension and safari-extension actors', () => {
    const mozStack = `Error\n    at bg (moz-extension://12345/bg.js:1:1)`;
    const blameMoz = getStorageDataBlame('moz_key', 'val', mozStack);
    expect(blameMoz.actor.type).toBe('extension');

    const safariStack = `Error\n    at bg (safari-extension://67890/bg.js:1:1)`;
    const blameSafari = getStorageDataBlame('safari_key', 'val', safariStack);
    expect(blameSafari.actor.type).toBe('extension');
  });

  it('should classify user actions for submit, toggle, eventlistener, and anonymous click', () => {
    const submitStack = `Error\n    at handleSubmit (https://example.com/form.js:10:2)`;
    const blameSubmit = getStorageDataBlame('form_key', 'val', submitStack);
    expect(blameSubmit.actor.type).toBe('user_action');

    const anonClickStack = `Error\n    at anonymous (https://example.com/button-handler.js:5:1)`;
    const blameAnonClick = getStorageDataBlame('anon_click_key', 'val', anonClickStack);
    expect(blameAnonClick.actor.name).toBe('Script (button-handler.js)');

    const userClickStack = `Error\n    at userClick (https://example.com/btn.js:5:1)`;
    const blameUserClick = getStorageDataBlame('user_click_key', 'val', userClickStack);
    expect(blameUserClick.actor.type).toBe('user_action');
  });

  it('should track conflict overwrites when different actors mutate the same key', () => {
    const registry = DataBlameRegistry.getInstance();
    const actorA = `Error\n    at setAuthToken (https://example.com/auth.js:10:5)`;
    const actorB = `Error\n    at injectScript (chrome-extension://1234/content.js:5:2)`;

    registry.recordMutation('shared_key', 'value_a', actorA);
    registry.recordMutation('shared_key', 'value_b', actorB);

    const blameRes = getStorageDataBlameResult('shared_key', 'value_b', actorB);
    expect(blameRes.ok).toBe(true);
    if (blameRes.ok) {
      expect(blameRes.value.hasConflictOverwrite).toBe(true);
      expect(blameRes.value.historyTimeline[0].isConflictOverwrite).toBe(true);
      expect(blameRes.value.historyTimeline[0].overwrittenActorName).toContain('setAuthToken');
    }
  });

  it('should strip query parameters and hash fragments from filenames', () => {
    const queryStack = `Error\n    at doUpdate (https://example.com/static/main.bundle.js?v=1.2.3#L50:10:5)`;
    const blame = getStorageDataBlame('query_key', 'val', queryStack);
    expect(blame.actor.name).toContain('main.bundle.js');
  });

  it('should cap mutation history timeline at 50 entries', () => {
    const registry = DataBlameRegistry.getInstance();
    for (let i = 0; i < 60; i++) {
      registry.recordMutation('capped_key', `val_${i}`);
    }

    const blame = getStorageDataBlame('capped_key', 'val_59');
    expect(blame.revisionCount).toBe(60);
    expect(blame.historyTimeline.length).toBe(50);
  });
});
