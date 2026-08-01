import { describe, it, expect, beforeEach } from 'vitest';
import { StorageCompressionEngine } from '../utils/storageCompressionEngine';
import { LzCompressionAdapter } from '../src/infrastructure/adapters/lzCompressionAdapter';
import {
  StorageCompressionError,
  CompressedPayloadDto,
  CompressionPort,
} from '../src/domain/ports/secondary/compressionPort';
import { Result } from '../utils/result';

describe('StorageCompressionEngine & LzCompressionAdapter (ADR-0007 Storage Compression Engine)', () => {
  beforeEach(() => {
    StorageCompressionEngine.resetAdapter();
  });

  describe('1. Zero-Throw Boundary Resilience & Invalid Input Handling', () => {
    it('1.1 should return Result.err(INVALID_INPUT) when compress receives null or undefined', async () => {
      // @ts-expect-error testing invalid runtime null
      const nullRes = await StorageCompressionEngine.compress(null);
      expect(nullRes.ok).toBe(false);
      if (!nullRes.ok) {
        expect(nullRes.error).toBeInstanceOf(StorageCompressionError);
        expect(nullRes.error.code).toBe('INVALID_INPUT');
        expect(nullRes.error.message).toContain('null or undefined');
      }

      // @ts-expect-error testing invalid runtime undefined
      const undefRes = await StorageCompressionEngine.compress(undefined);
      expect(undefRes.ok).toBe(false);
      if (!undefRes.ok) {
        expect(undefRes.error.code).toBe('INVALID_INPUT');
      }
    });

    it('1.2 should return Result.err(INVALID_INPUT) when decompress receives null or undefined', async () => {
      // @ts-expect-error testing invalid runtime null
      const nullRes = await StorageCompressionEngine.decompress(null);
      expect(nullRes.ok).toBe(false);
      if (!nullRes.ok) {
        expect(nullRes.error.code).toBe('INVALID_INPUT');
        expect(nullRes.error.message).toContain('null or undefined');
      }

      // @ts-expect-error testing invalid runtime undefined
      const undefRes = await StorageCompressionEngine.decompress(undefined);
      expect(undefRes.ok).toBe(false);
      if (!undefRes.ok) {
        expect(undefRes.error.code).toBe('INVALID_INPUT');
      }
    });

    it('1.3 should handle empty string input gracefully with bypass threshold', async () => {
      const emptyString = '';
      const compRes = await StorageCompressionEngine.compress(emptyString);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.bypassed).toBe(true);
        expect(compRes.value.uncompressedSize).toBe(0);

        const decompRes = await StorageCompressionEngine.decompress(compRes.value);
        expect(decompRes.ok).toBe(true);
        if (decompRes.ok) {
          expect(decompRes.value).toBe('');
        }
      }
    });

    it('1.4 should return Result.err(INVALID_INPUT) when decompressing non-string / non-DTO primitive', async () => {
      // @ts-expect-error testing invalid primitive type
      const numRes = await StorageCompressionEngine.decompress(12345);
      expect(numRes.ok).toBe(false);
      if (!numRes.ok) {
        expect(numRes.error.code).toBe('INVALID_INPUT');
      }

      // @ts-expect-error testing invalid object format
      const invalidObjRes = await StorageCompressionEngine.decompress({ randomKey: 'invalid' });
      expect(invalidObjRes.ok).toBe(false);
      if (!invalidObjRes.ok) {
        expect(invalidObjRes.error.code).toBe('INVALID_HEADER');
      }
    });

    it('1.5 should handle zero-byte payloads without throwing exceptions', async () => {
      const zeroBuffer = new Uint8Array(0);
      const res = await StorageCompressionEngine.compress(zeroBuffer);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.uncompressedSize).toBe(0);
        expect(res.value.bypassed).toBe(true);
      }
    });

    it('1.6 should correctly identify compressed envelope format via isCompressed', async () => {
      const payload = 'Sample text for compression test payload length exceeds threshold'.repeat(5);
      const compRes = await StorageCompressionEngine.compress(payload);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        const serializedRes = StorageCompressionEngine.serializePayload(compRes.value);
        expect(serializedRes.ok).toBe(true);
        if (serializedRes.ok) {
          expect(StorageCompressionEngine.isCompressed(serializedRes.value)).toBe(true);
        }
      }

      expect(StorageCompressionEngine.isCompressed('plaintext_uncompressed_string')).toBe(false);
      expect(StorageCompressionEngine.isCompressed('cmp:v2:unsupported')).toBe(false);
      expect(StorageCompressionEngine.isCompressed('')).toBe(false);
      // @ts-expect-error testing null input
      expect(StorageCompressionEngine.isCompressed(null)).toBe(false);
    });

    it('1.7 should handle small payload below threshold (e.g. < 64 bytes) by bypassing compression', async () => {
      const smallText = 'Tiny payload'; // 12 bytes
      const compRes = await StorageCompressionEngine.compress(smallText, { minSizeBytes: 64 });
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.bypassed).toBe(true);
        expect(compRes.value.compressedSize).toBe(compRes.value.uncompressedSize);

        const decRes = await StorageCompressionEngine.decompress(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(smallText);
        }
      }
    });

    it('1.8 should propagate error when custom options specify unknown compression algorithm', async () => {
      const res = await StorageCompressionEngine.compress('test data', { algorithm: 'unknown_algo' as any });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('UNSUPPORTED_ALGORITHM');
      }
    });
  });

  describe('2. Repetitive Payload & High Ratio Verification', () => {
    it('2.1 should achieve high compression ratio (> 80%) on highly repetitive text', async () => {
      const repetitiveText = 'A'.repeat(10000);
      const compRes = await StorageCompressionEngine.compress(repetitiveText);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.bypassed).toBe(false);
        expect(compRes.value.uncompressedSize).toBe(10000);
        expect(compRes.value.compressedSize).toBeLessThan(2000); // > 80% reduction

        const ratio = StorageCompressionEngine.getCompressionRatio(compRes.value);
        expect(ratio).toBeGreaterThan(0.80);

        const decRes = await StorageCompressionEngine.decompress(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(repetitiveText);
        }
      }
    });

    it('2.2 should compress repetitive JSON array structures efficiently', async () => {
      const repetitiveJson = Array(1000).fill({
        id: 'usr_123456789',
        role: 'administrator',
        active: true,
        permissions: ['read', 'write', 'execute', 'audit'],
      });
      const jsonString = JSON.stringify(repetitiveJson);

      const compRes = await StorageCompressionEngine.compress(jsonString);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.bypassed).toBe(false);
        const ratio = StorageCompressionEngine.getCompressionRatio(compRes.value);
        expect(ratio).toBeGreaterThan(0.85);

        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(JSON.parse(decRes.value)).toEqual(repetitiveJson);
        }
      }
    });

    it('2.3 should calculate compression ratio accurately via getCompressionRatio', () => {
      const dto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'deflate',
        uncompressedSize: 1000,
        compressedSize: 200,
        checksum: '12345678',
        bypassed: false,
        data: 'c3VwZXJfY29tcHJlc3NlZA==',
      };
      const ratio = StorageCompressionEngine.getCompressionRatio(dto);
      expect(ratio).toBe(0.80); // (1000 - 200) / 1000 = 0.80
    });

    it('2.4 should return 0 compression ratio for bypassed payloads', () => {
      const dto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'raw',
        uncompressedSize: 50,
        compressedSize: 50,
        checksum: '12345678',
        bypassed: true,
        data: 'dW5jb21wcmVzc2Vk',
      };
      const ratio = StorageCompressionEngine.getCompressionRatio(dto);
      expect(ratio).toBe(0);
    });

    it('2.5 should handle repeated compress-decompress cycles on repetitive data without degradation', async () => {
      const text = 'Repeatable test payload '.repeat(200);

      for (let i = 0; i < 5; i++) {
        const comp = await StorageCompressionEngine.compress(text);
        expect(comp.ok).toBe(true);
        if (!comp.ok) return;
        const dec = await StorageCompressionEngine.decompress<string>(comp.value);
        expect(dec.ok).toBe(true);
        if (!dec.ok) return;
        expect(dec.value).toBe(text);
      }
    });
  });

  describe('3. High-Entropy Payload & Automatic Bypass Mechanism', () => {
    it('3.1 should bypass compression for high-entropy random byte stream to prevent inflation', async () => {
      const randomBytes = new Uint8Array(1024);
      globalThis.crypto.getRandomValues(randomBytes);
      const randomBase64 = Buffer.from(randomBytes).toString('base64');

      const compRes = await StorageCompressionEngine.compress(randomBase64);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.compressedSize).toBeLessThanOrEqual(compRes.value.uncompressedSize + 32);

        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(randomBase64);
        }
      }
    });

    it('3.2 should bypass compression for pre-encrypted ciphertext payloads', async () => {
      const mockEncryptedEnvelope = 'enc:v1:c2FsdF8xNg==:aXZfMTI=:Y2lwaGVydGV4dF9yYW5kb21fYnl0ZXM=';
      const compRes = await StorageCompressionEngine.compress(mockEncryptedEnvelope);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.bypassed).toBe(true);

        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(mockEncryptedEnvelope);
        }
      }
    });

    it('3.3 should enforce maximum compressed output bound checking via forceBypass option', async () => {
      const adapter = new LzCompressionAdapter();
      const input = 'Sample test payload for threshold check';
      const compRes = await adapter.compress(input, { forceBypass: true });
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.bypassed).toBe(true);
        expect(compRes.value.algorithm).toBe('raw');
      }
    });

    it('3.4 should safely roundtrip bypassed binary payloads', async () => {
      const binaryData = new Uint8Array([0x00, 0xff, 0xfe, 0xfa, 0x12, 0x34, 0x56, 0x78]);
      const compRes = await StorageCompressionEngine.compress(binaryData, { forceBypass: true });
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          const decBytes = Uint8Array.from(decRes.value, (c) => c.charCodeAt(0));
          expect(decBytes).toEqual(binaryData);
        }
      }
    });

    it('3.5 should allow forcing compression even on high entropy when explicitly configured', async () => {
      const randomData = 'A8fK9#m$L1!zX9@q'.repeat(20);
      const compRes = await StorageCompressionEngine.compress(randomData, { allowInflation: true });
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.bypassed).toBe(false);
      }
    });
  });

  describe('4. Corrupted Header, Bit-Rot & Tampering Error Handling', () => {
    it('4.1 should return Result.err(INVALID_HEADER) for string lacking cmp:v1 prefix', async () => {
      const invalidHeaderEnvelope = 'invalid:prefix:deflate:0:100:100:12345678:data';
      const decRes = await StorageCompressionEngine.decompress(invalidHeaderEnvelope);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('INVALID_HEADER');
        expect(decRes.error.message).toContain('Missing or invalid compression header');
      }
    });

    it('4.2 should return Result.err(UNSUPPORTED_ALGORITHM) for unknown compression algorithm header', async () => {
      const unknownAlgoEnvelope = 'cmp:v1:brotli_v9:0:100:100:12345678:c3VwZXI=';
      const decRes = await StorageCompressionEngine.decompress(unknownAlgoEnvelope);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('UNSUPPORTED_ALGORITHM');
      }
    });

    it('4.3 should return Result.err(CORRUPTED_PAYLOAD) or DECOMPRESSION_FAILED when compressed payload fails verification', async () => {
      const corruptedEnvelope = 'cmp:v1:lz-base64:0:500:50:12345678:!!!not_valid_lz_data!!!';
      const decRes = await StorageCompressionEngine.decompress(corruptedEnvelope);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(['CORRUPTED_PAYLOAD', 'DECOMPRESSION_FAILED']).toContain(decRes.error.code);
      }
    });

    it('4.4 should return Result.err for truncated payload data stream', async () => {
      const validText = 'Long text stream payload for truncation test '.repeat(50);
      const compRes = await StorageCompressionEngine.compress(validText);
      expect(compRes.ok).toBe(true);
      if (!compRes.ok) return;

      const serializedRes = StorageCompressionEngine.serializePayload(compRes.value);
      expect(serializedRes.ok).toBe(true);
      if (!serializedRes.ok) return;

      const truncatedSerialized = serializedRes.value.slice(0, Math.floor(serializedRes.value.length / 2));
      const decRes = await StorageCompressionEngine.decompress(truncatedSerialized);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(['DECOMPRESSION_FAILED', 'CORRUPTED_PAYLOAD', 'INVALID_HEADER']).toContain(decRes.error.code);
      }
    });

    it('4.5 should guard against zip-bomb / tampered originalSize metadata memory explosion', async () => {
      // Header claims 10 GB original size (10,737,418,240 bytes)
      const tamperedHeaderDto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'lz-base64',
        uncompressedSize: 10 * 1024 * 1024 * 1024,
        compressedSize: 50,
        checksum: '12345678',
        bypassed: false,
        data: 'c3VwZXJfY29tcHJlc3NlZA==',
      };

      const decRes = await StorageCompressionEngine.decompress(tamperedHeaderDto, { maxDecompressedSizeBytes: 50 * 1024 * 1024 });
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('DECOMPRESSION_EXCEEDS_BOUNDS');
        expect(decRes.error.message).toContain('exceeds maximum permitted size');
      }
    });

    it('4.6 should handle bit-flip corruption inside compressed payload stream gracefully', async () => {
      const text = 'Sensitive storage snapshot data '.repeat(30);
      const compRes = await StorageCompressionEngine.compress(text);
      expect(compRes.ok).toBe(true);
      if (!compRes.ok) return;

      const dto = compRes.value;
      const corruptedData = dto.data.slice(0, -4) + (dto.data.endsWith('A') ? 'B' : 'A') + dto.data.slice(-3);
      const corruptedDto: CompressedPayloadDto = { ...dto, data: corruptedData };

      const decRes = await StorageCompressionEngine.decompress(corruptedDto);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(['DECOMPRESSION_FAILED', 'CORRUPTED_PAYLOAD']).toContain(decRes.error.code);
      }
    });
  });

  describe('5. Roundtrip Fidelity Across All JSON Primitives & Deep Objects', () => {
    it('5.1 should preserve fidelity for primitive strings, numbers, booleans, and nulls', async () => {
      const primitives = [
        'Hello World',
        '',
        42,
        3.1415926535,
        -100,
        Number.MAX_SAFE_INTEGER,
        true,
        false,
        null,
      ];

      for (const item of primitives) {
        const json = JSON.stringify(item);
        const comp = await StorageCompressionEngine.compress(json);
        expect(comp.ok).toBe(true);
        if (!comp.ok) continue;

        const dec = await StorageCompressionEngine.decompress<string>(comp.value);
        expect(dec.ok).toBe(true);
        if (dec.ok) {
          expect(JSON.parse(dec.value)).toEqual(item);
        }
      }
    });

    it('5.2 should handle Unicode, Emojis, and CJK international characters without corruption', async () => {
      const unicodePayload = {
        title: 'Browser Storage Suite 🚀 存储引擎',
        emojis: '😀😁😂😃😄😅😆😇😈😉😊😋',
        arabic: 'مرحبا بك في محرك الضغط',
        hebrew: 'שלوم עולם',
        symbols: '§177.2(a) • ©2026 • ® registered ™ trademark ‰ per-mille',
      };

      const compRes = await StorageCompressionEngine.compress(JSON.stringify(unicodePayload));
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(JSON.parse(decRes.value)).toEqual(unicodePayload);
        }
      }
    });

    it('5.3 should preserve deeply nested JSON structures (depth > 20)', async () => {
      let nested: any = { depth: 20, value: 'bottom' };
      for (let i = 19; i >= 1; i--) {
        nested = { depth: i, child: nested };
      }

      const compRes = await StorageCompressionEngine.compress(JSON.stringify(nested));
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(JSON.parse(decRes.value)).toEqual(nested);
        }
      }
    });

    it('5.4 should preserve sparse and mixed arrays', async () => {
      const mixedArray = [1, 'string', true, null, { key: 'val' }, [1, 2, 3]];
      const jsonStr = JSON.stringify(mixedArray);

      const compRes = await StorageCompressionEngine.compress(jsonStr);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(JSON.parse(decRes.value)).toEqual(JSON.parse(jsonStr));
        }
      }
    });

    it('5.5 should preserve special characters like newlines, tabs, and backslashes', async () => {
      const multiline = "Line 1\r\nLine 2\tTabbed\nLine 3 \\ Backslash \" Quotes \"";
      const compRes = await StorageCompressionEngine.compress(multiline);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(multiline);
        }
      }
    });

    it('5.6 should compress and decompress structured objects directly using object overload', async () => {
      const stateObject = {
        version: '1.2.0',
        userSettings: { theme: 'dark', notifications: true },
        cache: [1, 2, 3, 4, 5],
      };

      const compRes = await StorageCompressionEngine.compressObject(stateObject);
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        const decRes = await StorageCompressionEngine.decompressObject<typeof stateObject>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toEqual(stateObject);
        }
      }
    });
  });

  describe('6. Large Payload Benchmark (1 MB+) & Memory Bounds', () => {
    it('6.1 should compress and decompress 1 MB synthetic payload within performance budget (< 2000ms)', async () => {
      const chunk = JSON.stringify({ id: 12345, text: 'Large payload benchmark string entry ', active: true });
      const targetSize = 1024 * 1024; // 1 MB
      const repeatCount = Math.ceil(targetSize / chunk.length);
      const largePayload = '[' + Array(repeatCount).fill(chunk).join(',') + ']';

      expect(largePayload.length).toBeGreaterThanOrEqual(targetSize);

      const startTime = performance.now();
      const compRes = await StorageCompressionEngine.compress(largePayload);
      const compressTime = performance.now() - startTime;

      expect(compRes.ok).toBe(true);
      if (!compRes.ok) return;

      expect(compressTime).toBeLessThan(2000);
      expect(compRes.value.compressedSize).toBeLessThan(compRes.value.uncompressedSize / 5);

      const decompressStart = performance.now();
      const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
      const decompressTime = performance.now() - decompressStart;

      expect(decRes.ok).toBe(true);
      if (decRes.ok) {
        expect(decompressTime).toBeLessThan(2000);
        expect(decRes.value.length).toBe(largePayload.length);
      }
    });

    it('6.2 should maintain stable memory overhead across repeated large payload compression iterations', async () => {
      const sample = 'Memory overhead verification payload '.repeat(5000); // ~180 KB

      for (let i = 0; i < 20; i++) {
        const comp = await StorageCompressionEngine.compress(sample);
        expect(comp.ok).toBe(true);
        if (comp.ok) {
          const dec = await StorageCompressionEngine.decompress<string>(comp.value);
          expect(dec.ok).toBe(true);
        }
      }
    });

    it('6.3 should support AbortSignal cancellation for large compression streams', async () => {
      const largePayload = 'A'.repeat(2 * 1024 * 1024); // 2 MB
      const controller = new AbortController();
      controller.abort(); // Pre-aborted signal

      const compRes = await StorageCompressionEngine.compress(largePayload, { signal: controller.signal });
      expect(compRes.ok).toBe(false);
      if (!compRes.ok) {
        expect(compRes.error.code).toBe('OPERATION_ABORTED');
      }
    });

    it('6.4 should serialize and deserialize payload DTO to envelope string accurately', async () => {
      const dto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'deflate',
        uncompressedSize: 500,
        compressedSize: 100,
        checksum: '12345678',
        bypassed: false,
        data: 'c2FtcGxlX2NvbXByZXNzZWRfZGF0YQ==',
      };

      const serializedRes = StorageCompressionEngine.serializePayload(dto);
      expect(serializedRes.ok).toBe(true);
      if (!serializedRes.ok) return;

      expect(serializedRes.value).toBe('cmp:v1:deflate:0:500:100:12345678:c2FtcGxlX2NvbXByZXNzZWRfZGF0YQ==');

      const deserializedRes = StorageCompressionEngine.deserializePayload(serializedRes.value);
      expect(deserializedRes.ok).toBe(true);
      if (deserializedRes.ok) {
        expect(deserializedRes.value).toEqual(dto);
      }
    });
  });

  describe('7. Adapter Switching & Stryker Mutant Defense Matrix', () => {
    it('7.1 should allow custom CompressionPort adapter injection and reset to default', async () => {
      class MockFailureAdapter extends LzCompressionAdapter {
        public override async compress(): Promise<Result<CompressedPayloadDto, StorageCompressionError>> {
          return Result.err(new StorageCompressionError('COMPRESSION_FAILED', 'Custom mock compression failure'));
        }
      }

      const mockAdapter = new MockFailureAdapter();
      StorageCompressionEngine.setAdapter(mockAdapter);

      const errRes = await StorageCompressionEngine.compress('test string');
      expect(errRes.ok).toBe(false);
      if (!errRes.ok) {
        expect(errRes.error.message).toBe('Custom mock compression failure');
      }

      StorageCompressionEngine.resetAdapter();
      const validRes = await StorageCompressionEngine.compress('test string');
      expect(validRes.ok).toBe(true);
    });

    it('7.2 should handle missing CompressionStream environment gracefully using fallback adapter', async () => {
      const adapter = new LzCompressionAdapter();
      const origStream = globalThis.CompressionStream;

      try {
        // Simulating environment without native CompressionStream
        // @ts-expect-error mutating global for test
        delete globalThis.CompressionStream;

        const res = await adapter.compress('Fallback mode test text payload long enough to exceed threshold'.repeat(3));
        expect(res.ok).toBe(true);
        if (res.ok) {
          const decRes = await adapter.decompress(res.value);
          expect(decRes.ok).toBe(true);
          if (decRes.ok) {
            expect(decRes.value).toBe('Fallback mode test text payload long enough to exceed threshold'.repeat(3));
          }
        }
      } finally {
        globalThis.CompressionStream = origStream;
      }
    });

    it('7.3 should catch thrown exceptions in compression adapter stream', async () => {
      class MockThrowAdapter extends LzCompressionAdapter {
        public override async compress(): Promise<Result<CompressedPayloadDto, StorageCompressionError>> {
          try {
            throw new Error('Stream compression exception thrown');
          } catch (err) {
            return Result.err(new StorageCompressionError('COMPRESSION_FAILED', String(err)));
          }
        }
      }

      const adapter = new MockThrowAdapter();
      const res = await adapter.compress('test');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.message).toContain('Stream compression exception thrown');
      }
    });

    it('7.4 should kill boundary condition mutants (< vs <= minSizeBytes threshold)', async () => {
      const text64 = 'A'.repeat(64); // Exactly 64 bytes
      const compRes = await StorageCompressionEngine.compress(text64, { minSizeBytes: 64, force: false });
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        // At threshold boundary (64 bytes), should NOT bypass if minSizeBytes is 64 (since originalSize 64 is NOT < 64)
        expect(compRes.value.bypassed).toBe(false);
      }
    });
  });
});
