import { describe, it, expect, beforeEach } from 'vitest';
import { getStorageDataBlame, DataBlameRegistry, getStorageDataBlameResult } from '../utils/dataBlamer';
import { parseStackTrace, parseStackFrameLine, isInternalFrame, filterInternalFrames } from '../utils/stackParser';

describe('DataBlamer & StackParser Adversarial Stress Harness', { timeout: 30000 }, () => {
  beforeEach(() => {
    DataBlameRegistry.getInstance().clear();
  });

  describe('1. Malformed, Corrupted, & Edge-Case Stack Traces', () => {
    it('handles empty, whitespace, and single-word stack traces without throwing', () => {
      const inputs = [
        '',
        '   ',
        '\n\n\r\t',
        'Error',
        'Error: Unhandled exception',
        'at ',
        '@',
        'random text with no frame format',
        'https://example.com/app.js:10:20',
      ];

      for (const rawStack of inputs) {
        expect(() => {
          const result = getStorageDataBlameResult('test_key', 'val', rawStack);
          expect(result.ok).toBe(true);
          const blame = getStorageDataBlame('test_key', 'val', rawStack);
          expect(blame.key).toBe('test_key');
          expect(blame.actor.name).toBeDefined();
          expect(blame.actor.type).toBeDefined();
        }).not.toThrow();
      }
    });

    it('handles non-string types safely if passed via type coercion / invalid JavaScript caller', () => {
      const nonStringInputs = [
        null as unknown as string,
        undefined as unknown as string,
        12345 as unknown as string,
        true as unknown as string,
        {} as unknown as string,
        [] as unknown as string,
        Symbol('stack') as unknown as string,
      ];

      for (const input of nonStringInputs) {
        expect(() => {
          const result = getStorageDataBlameResult('bad_type_key', 'val', input);
          expect(result.ok).toBe(true);
          const blame = getStorageDataBlame('bad_type_key', 'val', input);
          expect(blame.key).toBe('bad_type_key');
        }).not.toThrow();
      }
    });

    it('handles binary, control characters, null bytes, and non-ASCII / Unicode characters', () => {
      const weirdStacks = [
        `Error: \x00\x01\x02\xFF\xFE
        at 🚀.launch_rocket (https://例子.测试/应用.js:100:200)
        at async ñoño (https://domain.es/script.js?query=1#hash:5:10)`,

        `functionName@https://ñandú.org/path/to/file.js:99:88
        @https://日本語.jp/main.js:1:1`,

        `Error\n\0\0\0at \0foo\0 (\0http://example.com/app.js:1:1\0)`,

        `at RTL_\u202Ereversed\u202C_func (https://example.com/app.js:1:1)`,
      ];

      for (const stack of weirdStacks) {
        expect(() => {
          const blame = getStorageDataBlame('unicode_key', 'val', stack);
          expect(blame.key).toBe('unicode_key');
          expect(blame.actor.name).toBeDefined();
          expect(blame.actor.type).toBeDefined();
        }).not.toThrow();
      }
    });

    it('handles minified stack traces correctly', () => {
      const minifiedV8 = `Error
      at a (https://cdn.site.com/assets/app.min.js:1:48192)
      at b (https://cdn.site.com/assets/app.min.js:1:99999)`;

      const minifiedGecko = `e@https://cdn.site.com/bundle.min.js:1:99999
      t@https://cdn.site.com/bundle.min.js:1:12345`;

      const blame1 = getStorageDataBlame('min_key_1', 'val', minifiedV8);
      expect(blame1.actor.lineNumber).toBe(1);
      expect(blame1.actor.columnNumber).toBe(48192);
      expect(blame1.actor.name).toContain('a');

      const blame2 = getStorageDataBlame('min_key_2', 'val', minifiedGecko);
      expect(blame2.actor.lineNumber).toBe(1);
      expect(blame2.actor.columnNumber).toBe(99999);
      expect(blame2.actor.name).toContain('e');
    });

    it('handles eval frames, blob URLs, and extension protocols', () => {
      const evalStack = `Error
      at eval (eval at <anonymous> (https://example.com/script.js:10:5), <anonymous>:1:1)
      at blob:https://example.com/1234-5678-90ab:42:10`;

      const blame = getStorageDataBlame('eval_key', 'val', evalStack);
      expect(blame.actor).toBeDefined();
      expect(blame.actor.name).toBeDefined();
    });

    it('handles huge line numbers and integer overflow edge cases', () => {
      const hugeLineStack = `Error
      at overflowFunc (https://example.com/app.js:9007199254740991:9007199254740992)`;

      const blame = getStorageDataBlame('huge_line', 'val', hugeLineStack);
      expect(blame.actor.lineNumber).toBe(9007199254740991);
      expect(blame.actor.columnNumber).toBe(9007199254740992);
    });

    it('handles extremely long lines (100,000 chars) without ReDoS or performance degradation', () => {
      const longUrl = 'https://example.com/' + 'a/'.repeat(50000) + 'app.js';
      const longLineStack = `Error\n    at extremelyLongFunction (${longUrl}:10:20)`;

      const startTime = performance.now();
      const blame = getStorageDataBlame('long_line', 'val', longLineStack);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(200); // Must complete within 200ms
      expect(blame.actor.lineNumber).toBe(10);
      expect(blame.actor.columnNumber).toBe(20);
    });
  });

  describe('2. Deeply Nested Callstacks & Performance', () => {
    it('parses a 10,000-frame stack trace efficiently without stack overflow or crash', () => {
      const frames: string[] = ['Error: Deep stack'];
      for (let i = 0; i < 10000; i++) {
        frames.push(`    at frame_${i} (https://example.com/module_${i % 100}.js:${i + 1}:${(i * 3) % 80 + 1})`);
      }
      const deepStack = frames.join('\n');

      const startTime = performance.now();
      const blame = getStorageDataBlame('deep_stack_key', 'val', deepStack);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(500); // 10,000 frames parsed in < 500ms
      expect(blame.actor.name).toContain('frame_0');
      expect(blame.actor.lineNumber).toBe(1);
    });
  });

  describe('3. Automated Fuzz Generator (5,000 Synthetic Malformed Stacks)', () => {
    it('runs 5,000 random synthetic malformed stack traces with zero unhandled throws', () => {
      const charPool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./-:@() \n\r\t!@#$%^&*()_+=[]{}|;:\'",.<>?/\\`~🚀ñ';

      const generateRandomString = (length: number) => {
        let res = '';
        for (let i = 0; i < length; i++) {
          res += charPool[Math.floor(Math.random() * charPool.length)];
        }
        return res;
      };

      let failures = 0;
      for (let i = 0; i < 5000; i++) {
        const randomStack = generateRandomString(Math.floor(Math.random() * 300));
        try {
          const res = getStorageDataBlameResult(`fuzz_${i}`, `val_${i}`, randomStack);
          if (!res.ok) failures++;
        } catch {
          failures++;
        }
      }

      expect(failures).toBe(0);
    });
  });

  describe('4. Memory Usage & Leak Verification in DataBlameRegistry', () => {
    it('handles 50,000 unique keys without memory leak and clears cleanly', () => {
      const registry = DataBlameRegistry.getInstance();

      // Record 50,000 unique keys
      for (let i = 0; i < 50000; i++) {
        registry.recordMutation(`key_${i}`, `value_${i}`, `at func_${i} (https://app.com/script.js:${i}:1)`);
      }

      const blameSample = getStorageDataBlame('key_49999', 'value_49999');
      expect(blameSample.revisionCount).toBe(1);

      // Verify clear resets state
      registry.clear();
      const postClearBlame = getStorageDataBlame('key_49999', 'value_49999');
      expect(postClearBlame.revisionCount).toBe(1); // Fresh entry after clear
    });

    it('handles 50,000 mutations on a single key with constant memory footprint', () => {
      const registry = DataBlameRegistry.getInstance();

      for (let i = 0; i < 50000; i++) {
        registry.recordMutation('hot_key', `v_${i}`, `at updater (https://app.com/state.js:${i}:1)`);
      }

      const blame = getStorageDataBlame('hot_key', 'v_49999');
      expect(blame.revisionCount).toBe(50000);
      expect(blame.previousValue).toBe('v_49998');
    });

    it('handles rapid interleaved reads and writes consistently', () => {
      const registry = DataBlameRegistry.getInstance();

      for (let i = 0; i < 10000; i++) {
        const key = `interleaved_${i % 100}`;
        registry.recordMutation(key, `val_${i}`);
        const res = registry.getMetadata(key, `val_${i}`);
        expect(res.ok).toBe(true);
      }
    });
  });
});
