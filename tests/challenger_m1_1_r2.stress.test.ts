import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStorageDataBlame,
  getStorageDataBlameResult,
  DataBlameRegistry,
  ScriptOrigin,
  BlameActor,
  type DataBlameInfo,
} from '../utils/dataBlamer';
import {
  parseStackTrace,
  parseStackFrameLine,
  isInternalFrame,
  filterInternalFrames,
  type StackFrame,
} from '../utils/stackParser';

describe('Challenger M1.1 R2 — Empirical Stress Harness for DataBlamer & StackParser', () => {
  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
  });

  describe('1. Cross-Browser & Path Format Parsing (stackParser.ts)', () => {
    it('parses V8 / Chrome / Edge callstack formats including async, class methods, and anonymous', () => {
      const v8Stack = `Error
    at setAuthToken (https://example.com/static/js/auth-bundle.js:284:12)
    at async handleLogin (https://example.com/static/js/login.ts:45:3)
    at AuthController.login (https://example.com/controllers/auth.ts:120:15)
    at https://example.com/static/js/main.js:10:5`;

      const frames = parseStackTrace(v8Stack);
      expect(frames.length).toBe(4);

      expect(frames[0].functionName).toBe('setAuthToken');
      expect(frames[0].scriptUrl).toBe('https://example.com/static/js/auth-bundle.js');
      expect(frames[0].lineNumber).toBe(284);
      expect(frames[0].columnNumber).toBe(12);

      expect(frames[1].functionName).toBe('async handleLogin');
      expect(frames[1].scriptUrl).toBe('https://example.com/static/js/login.ts');

      expect(frames[2].functionName).toBe('AuthController.login');
      expect(frames[3].functionName).toBe('anonymous');
    });

    it('parses Gecko / SpiderMonkey / Firefox and WebKit / Safari callstack formats', () => {
      const geckoStack = `setAuthToken@https://example.com/static/js/auth-bundle.js:284:12
handleLogin@https://example.com/login.ts:45:3
@https://example.com/main.js:10:5`;

      const frames = parseStackTrace(geckoStack);
      expect(frames.length).toBe(3);

      expect(frames[0].functionName).toBe('setAuthToken');
      expect(frames[0].scriptUrl).toBe('https://example.com/static/js/auth-bundle.js');
      expect(frames[0].lineNumber).toBe(284);
      expect(frames[0].columnNumber).toBe(12);

      expect(frames[1].functionName).toBe('handleLogin');
      expect(frames[2].functionName).toBe('anonymous');
    });

    it('parses Windows local file paths with drive letters, spaces, and backslashes', () => {
      const winV8Stack = `Error
    at setAuthToken (C:\\Users\\kluth\\Projects\\browser-storage-suite\\auth-bundle.js:284:12)
    at run (C:\\Program Files (x86)\\App\\main.js:50:20)
    at fn (d:\\dev\\project\\file.js:1:2)`;

      const frames = parseStackTrace(winV8Stack);
      expect(frames.length).toBe(3);

      expect(frames[0].functionName).toBe('setAuthToken');
      expect(frames[0].scriptUrl).toBe('C:\\Users\\kluth\\Projects\\browser-storage-suite\\auth-bundle.js');
      expect(frames[0].lineNumber).toBe(284);
      expect(frames[0].columnNumber).toBe(12);

      expect(frames[1].scriptUrl).toBe('C:\\Program Files (x86)\\App\\main.js');
      expect(frames[2].scriptUrl).toBe('d:\\dev\\project\\file.js');
    });

    it('parses Firefox Windows local paths in Gecko format', () => {
      const winGeckoStack = `setAuthToken@C:\\Users\\kluth\\Projects\\browser-storage-suite\\auth-bundle.js:284:12
@d:\\dev\\project\\file.js:10:5`;

      const frames = parseStackTrace(winGeckoStack);
      expect(frames.length).toBe(2);

      expect(frames[0].functionName).toBe('setAuthToken');
      expect(frames[0].scriptUrl).toBe('C:\\Users\\kluth\\Projects\\browser-storage-suite\\auth-bundle.js');
      expect(frames[1].scriptUrl).toBe('d:\\dev\\project\\file.js');
    });

    it('parses Blob URLs, Web Workers, and Browser Extension protocols', () => {
      const specialStack = `Error
    at inject (chrome-extension://abcdefghijklmnopqrstuvwxyz/content.js:30:40)
    at background (moz-extension://12345678-1234-1234-1234-1234567890ab/background.js:5:10)
    at worker (blob:https://example.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d:10:20)`;

      const frames = parseStackTrace(specialStack);
      expect(frames.length).toBe(3);

      expect(frames[0].scriptUrl).toBe('chrome-extension://abcdefghijklmnopqrstuvwxyz/content.js');
      expect(frames[1].scriptUrl).toBe('moz-extension://12345678-1234-1234-1234-1234567890ab/background.js');
      expect(frames[2].scriptUrl).toBe('blob:https://example.com/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
    });

    it('correctly identifies and filters internal frames (vitest, stackparser, datablamer, etc.)', () => {
      const internalStack = `Error
    at getStorageDataBlame (https://example.com/utils/dataBlamer.ts:15:3)
    at parseStackTrace (https://example.com/utils/stackParser.ts:40:10)
    at node_modules/vitest/dist/index.js:100:5
    at myBusinessLogic (https://example.com/src/app.ts:50:2)`;

      const parsed = parseStackTrace(internalStack);
      const filtered = filterInternalFrames(parsed);

      expect(filtered.length).toBe(1);
      expect(filtered[0].functionName).toBe('myBusinessLogic');
      expect(filtered[0].scriptUrl).toBe('https://example.com/src/app.ts');
    });
  });

  describe('2. Unicode & Special Character Handling', () => {
    it('handles emoji, CJK, non-ASCII, and query strings in function names and URLs', () => {
      const unicodeStack = `Error
    at 🚀_launchRocket (https://✨.example.org/🚀.js?v=1&tag=ñ#section:100:200)
    at 数据Blame (https://例子.测试/应用.js:50:10)
    at processñAndÚ (https://domain.es/méxico.js:12:34)`;

      const blame = getStorageDataBlame('unicode_key', 'val', unicodeStack);

      expect(blame.actor).toBeDefined();
      expect(blame.actor.name).toContain('🚀_launchRocket');
      expect(blame.actor.lineNumber).toBe(100);
      expect(blame.actor.columnNumber).toBe(200);

      const parsed = parseStackTrace(unicodeStack);
      expect(parsed[1].functionName).toBe('数据Blame');
      expect(parsed[2].functionName).toBe('processñAndÚ');
    });
  });

  describe('3. DDD Value Objects (ScriptOrigin & BlameActor) Invariants & State', () => {
    it('verifies ScriptOrigin value object construction, sanitization, and immutability', () => {
      const res1 = ScriptOrigin.create('https://example.com/script.js', 'myFunc', 10, 20);
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        const origin = res1.value;
        expect(origin).toBeInstanceOf(ScriptOrigin);
        expect(origin.scriptUrl).toBe('https://example.com/script.js');
        expect(origin.functionName).toBe('myFunc');
        expect(origin.lineNumber).toBe(10);
        expect(origin.columnNumber).toBe(20);
        expect(origin.toFormattedString()).toBe('https://example.com/script.js:L10:20');
      }

      // Negative line/col clamped to 0
      const res2 = ScriptOrigin.create('', '', -5, -10);
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value.scriptUrl).toBe('unknown');
        expect(res2.value.functionName).toBe('anonymous');
        expect(res2.value.lineNumber).toBe(0);
        expect(res2.value.columnNumber).toBe(0);
      }
    });

    it('verifies BlameActor value object construction, validation, and getters', () => {
      const originRes = ScriptOrigin.create('https://example.com/app.js', 'init', 100, 5);
      expect(originRes.ok).toBe(true);
      const origin = originRes.ok ? originRes.value : undefined;

      const actorRes = BlameActor.create('Init Script', 'script', origin, 'snippet content');
      expect(actorRes.ok).toBe(true);

      if (actorRes.ok) {
        const actor = actorRes.value;
        expect(actor).toBeInstanceOf(BlameActor);
        expect(actor.name).toBe('Init Script');
        expect(actor.type).toBe('script');
        expect(actor.scriptUrl).toBe('https://example.com/app.js:L100');
        expect(actor.lineNumber).toBe(100);
        expect(actor.columnNumber).toBe(5);
        expect(actor.stackTraceSnippet).toBe('snippet content');
      }

      // Empty name validation failure
      const invalidActor = BlameActor.create('   ', 'script');
      expect(invalidActor.ok).toBe(false);
      if (!invalidActor.ok) {
        expect(invalidActor.error).toBe('Actor name cannot be empty');
      }
    });

    it('verifies DataBlamer output contains true BlameActor and ScriptOrigin instances', () => {
      const winStack = `Error\n    at updateCart (C:\\Shop\\cart.js:45:10)`;
      const blame = getStorageDataBlame('cart_items', '[{"id": 1}]', winStack);

      expect(blame.actor).toBeInstanceOf(BlameActor);
      expect(blame.actor.origin).toBeInstanceOf(ScriptOrigin);
      expect(blame.actor.name).toContain('updateCart');
      expect(blame.actor.scriptUrl).toContain('C:\\Shop\\cart.js:L45');
      expect(blame.actor.lineNumber).toBe(45);
      expect(blame.actor.columnNumber).toBe(10);
    });
  });

  describe('4. Deep Callstack & High Revision Stress', () => {
    it('parses a 20,000-frame stack trace without stack overflow or performance degradation', () => {
      const frames: string[] = ['Error: Massive callstack'];
      for (let i = 0; i < 20000; i++) {
        frames.push(`    at frame_${i} (C:\\Projects\\app\\module_${i % 50}.js:${i + 1}:${(i * 7) % 100 + 1})`);
      }
      const massiveStack = frames.join('\n');

      const start = performance.now();
      const blame = getStorageDataBlame('massive_key', 'val', massiveStack);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(3000); // 20,000 frames parsed under 3 sec
      expect(blame.actor.name).toContain('frame_0');
      expect(blame.actor.scriptUrl).toContain('module_0.js:L1');
    });

    it('tracks 10,000 mutations per key maintaining exact revision counts and previous values', () => {
      const registry = DataBlameRegistry.getInstance();
      for (let i = 1; i <= 10000; i++) {
        registry.recordMutation('key_stress', `val_${i}`, `at mutate (https://example.com/app.js:${i}:1)`);
      }

      const blame = getStorageDataBlame('key_stress', 'val_10000');
      expect(blame.revisionCount).toBe(10000);
      expect(blame.previousValue).toBe('val_9999');
    });
  });

  describe('5. Automated Fuzz Generator (10,000 Random Malformed Stacks — Zero Unhandled Throws)', () => {
    it('executes 10,000 random fuzz inputs with ZERO unhandled exceptions', () => {
      const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./-:@() \n\r\t!@#$%^&*()_+=[]{}|;:\'",.<>?/\\`~🚀ñ';
      const getRandomStr = (len: number) => {
        let res = '';
        for (let j = 0; j < len; j++) {
          res += charset[Math.floor(Math.random() * charset.length)];
        }
        return res;
      };

      let failureCount = 0;
      for (let i = 0; i < 10000; i++) {
        const fuzzStack = getRandomStr(Math.floor(Math.random() * 250));
        try {
          const res = getStorageDataBlameResult(`fuzz_key_${i}`, `val_${i}`, fuzzStack);
          if (!res.ok) {
            failureCount++;
          }
          const blame = getStorageDataBlame(`fuzz_key_${i}`, `val_${i}`, fuzzStack);
          if (!blame || !blame.actor) {
            failureCount++;
          }
        } catch {
          failureCount++;
        }
      }

      expect(failureCount).toBe(0);
    });

    it('handles non-string primitives safely without unhandled throws', () => {
      const badInputs = [
        null as unknown as string,
        undefined as unknown as string,
        12345 as unknown as string,
        true as unknown as string,
        false as unknown as string,
        { stack: 'fake' } as unknown as string,
        [1, 2, 3] as unknown as string,
        Symbol('stack') as unknown as string,
      ];

      for (const bad of badInputs) {
        expect(() => {
          const res = getStorageDataBlameResult('bad_input_key', 'val', bad);
          expect(res.ok).toBe(true);
          const blame = getStorageDataBlame('bad_input_key', 'val', bad);
          expect(blame.key).toBe('bad_input_key');
          expect(blame.actor).toBeDefined();
        }).not.toThrow();
      }
    });
  });
});
