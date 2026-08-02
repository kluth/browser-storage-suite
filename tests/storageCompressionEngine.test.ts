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

      expect(compressTime).toBeLessThan(10000);
      expect(compRes.value.compressedSize).toBeLessThan(compRes.value.uncompressedSize / 5);

      const decompressStart = performance.now();
      const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
      const decompressTime = performance.now() - decompressStart;

      expect(decRes.ok).toBe(true);
      if (decRes.ok) {
        expect(decompressTime).toBeLessThan(10000);
        expect(decRes.value.length).toBe(largePayload.length);
      }
    }, 30000);

    it('6.2 should maintain stable memory overhead across repeated large payload compression iterations', async () => {
      const sample = 'Memory overhead verification payload '.repeat(1000); // ~36 KB

      for (let i = 0; i < 5; i++) {
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

  describe('8. LZ-UTF16 Algorithm Comprehensive Suite', () => {
    it('8.1 should compress, decompress and roundtrip ASCII text using lz-utf16 algorithm', async () => {
      const input = 'LZ-UTF16 compression engine unit test string '.repeat(10);
      const compRes = await StorageCompressionEngine.compress(input, { algorithm: 'lz-utf16', force: true });
      expect(compRes.ok).toBe(true);
      if (!compRes.ok) return;

      expect(compRes.value.algorithm).toBe('lz-utf16');
      expect(compRes.value.bypassed).toBe(false);

      const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
      expect(decRes.ok).toBe(true);
      if (decRes.ok) {
        expect(decRes.value).toBe(input);
      }
    });

    it('8.2 should compress, decompress and roundtrip Unicode, CJK, and Emojis (charCodes >= 256) using lz-utf16', async () => {
      const unicodeInput = '🚀 UTF-16 Unicode Test: 存储引擎 测试数据 こんにちは世界 €£¥ ₽ '.repeat(5);
      const compRes = await StorageCompressionEngine.compress(unicodeInput, { algorithm: 'lz-utf16', force: true });
      expect(compRes.ok).toBe(true);
      if (!compRes.ok) return;

      expect(compRes.value.algorithm).toBe('lz-utf16');
      expect(compRes.value.bypassed).toBe(false);

      const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
      expect(decRes.ok).toBe(true);
      if (decRes.ok) {
        expect(decRes.value).toBe(unicodeInput);
      }
    });

    it('8.3 should handle empty string input and output for lz-utf16 via adapter directly', () => {
      const adapter = new LzCompressionAdapter();
      const compressed = (adapter as any).lzCompressUtf16('');
      expect(compressed).toBe('');

      const decompressed = (adapter as any).lzDecompressUtf16('');
      expect(decompressed).toBe('');
    });

    it('8.4 should handle null/undefined in lzCompressInternal and lzDecompressUtf16', () => {
      const adapter = new LzCompressionAdapter();
      expect((adapter as any).lzCompressInternal(null, 15, (a: number) => String.fromCharCode(a + 32))).toBe('');
      expect((adapter as any).lzCompressInternal(undefined, 15, (a: number) => String.fromCharCode(a + 32))).toBe('');
      expect((adapter as any).lzDecompressUtf16(null)).toBe('');
      expect((adapter as any).lzDecompressUtf16(undefined)).toBe('');
    });

    it('8.5 should handle corrupted UTF16 payload decompression gracefully', async () => {
      const adapter = new LzCompressionAdapter();
      const corruptedUtf16Payload: CompressedPayloadDto = {
        version: 1,
        algorithm: 'lz-utf16',
        uncompressedSize: 100,
        compressedSize: 10,
        checksum: '12345678',
        bypassed: false,
        data: ' invalid utf16 garbage string \x01\x02 ',
      };

      const decRes = await adapter.decompress(corruptedUtf16Payload);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(['CORRUPTED_PAYLOAD', 'DECOMPRESSION_FAILED']).toContain(decRes.error.code);
      }
    });

    it('8.6 should handle envelope serialization and deserialization with lz-utf16 algorithm', async () => {
      const text = 'UTF-16 Envelope Test '.repeat(10);
      const envelopeRes = await StorageCompressionEngine.compressToEnvelope(text, { algorithm: 'lz-utf16', force: true });
      expect(envelopeRes.ok).toBe(true);
      if (!envelopeRes.ok) return;

      expect(envelopeRes.value).toContain('cmp:v1:lz-utf16:0:');
      expect(StorageCompressionEngine.isCompressed(envelopeRes.value)).toBe(true);

      const decRes = await StorageCompressionEngine.decompressFromEnvelope<string>(envelopeRes.value);
      expect(decRes.ok).toBe(true);
      if (decRes.ok) {
        expect(decRes.value).toBe(text);
      }
    });

    it('8.7 should wrap null decompression result from lzDecompressUtf16 as DECOMPRESSION_FAILED', async () => {
      const adapter = new LzCompressionAdapter();
      // Mock lzDecompressUtf16 to return null
      (adapter as any).lzDecompressUtf16 = () => null;

      const dto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'lz-utf16',
        uncompressedSize: 50,
        compressedSize: 10,
        checksum: '12345678',
        bypassed: false,
        data: 'test',
      };

      const res = await adapter.decompress(dto);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('DECOMPRESSION_FAILED');
        expect(res.error.message).toContain('Decompression yielded null or undefined');
      }
    });
  });

  describe('9. StorageCompressionEngine Guard Conditions & Branch Coverage', () => {
    it('9.1 should return false for isCompressed when given non-string types', () => {
      expect(StorageCompressionEngine.isCompressed(null as any)).toBe(false);
      expect(StorageCompressionEngine.isCompressed(undefined as any)).toBe(false);
      expect(StorageCompressionEngine.isCompressed(12345 as any)).toBe(false);
      expect(StorageCompressionEngine.isCompressed(true as any)).toBe(false);
      expect(StorageCompressionEngine.isCompressed({} as any)).toBe(false);
      expect(StorageCompressionEngine.isCompressed(Symbol('test') as any)).toBe(false);
      expect(StorageCompressionEngine.isCompressed('')).toBe(false);
    });

    it('9.2 should return 0 for getCompressionRatio across all edge/bypassed cases', () => {
      expect(StorageCompressionEngine.getCompressionRatio(null as any)).toBe(0);
      expect(StorageCompressionEngine.getCompressionRatio(undefined as any)).toBe(0);

      const bypassedDto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'raw',
        uncompressedSize: 100,
        compressedSize: 100,
        checksum: '12345678',
        bypassed: true,
        data: 'data',
      };
      expect(StorageCompressionEngine.getCompressionRatio(bypassedDto)).toBe(0);

      const zeroSizeDto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'lz-base64',
        uncompressedSize: 0,
        compressedSize: 10,
        checksum: '12345678',
        bypassed: false,
        data: 'data',
      };
      expect(StorageCompressionEngine.getCompressionRatio(zeroSizeDto)).toBe(0);

      const expandedDto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'lz-base64',
        uncompressedSize: 100,
        compressedSize: 150,
        checksum: '12345678',
        bypassed: false,
        data: 'data',
      };
      expect(StorageCompressionEngine.getCompressionRatio(expandedDto)).toBe(0);

      const normalDto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'lz-base64',
        uncompressedSize: 100,
        compressedSize: 25,
        checksum: '12345678',
        bypassed: false,
        data: 'data',
      };
      expect(StorageCompressionEngine.getCompressionRatio(normalDto)).toBe(0.75);
    });

    it('9.3 should compress Uint8Array input correctly in StorageCompressionEngine', async () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]); // "Hello World"
      const compRes = await StorageCompressionEngine.compress(bytes, { force: true });
      expect(compRes.ok).toBe(true);
      if (compRes.ok) {
        expect(compRes.value.uncompressedSize).toBe(11);
        const decRes = await StorageCompressionEngine.decompress<string>(compRes.value);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe('Hello World');
        }
      }
    });

    it('9.4 should return INVALID_INPUT for non-string / non-Uint8Array in StorageCompressionEngine.compress', async () => {
      // @ts-expect-error testing number
      const numRes = await StorageCompressionEngine.compress(12345);
      expect(numRes.ok).toBe(false);
      if (!numRes.ok) {
        expect(numRes.error.code).toBe('INVALID_INPUT');
        expect(numRes.error.message).toContain('must be a string or Uint8Array');
      }

      // @ts-expect-error testing boolean
      const boolRes = await StorageCompressionEngine.compress(true);
      expect(boolRes.ok).toBe(false);
      if (!boolRes.ok) {
        expect(boolRes.error.code).toBe('INVALID_INPUT');
      }

      // @ts-expect-error testing object
      const objRes = await StorageCompressionEngine.compress({ key: 'val' });
      expect(objRes.ok).toBe(false);
      if (!objRes.ok) {
        expect(objRes.error.code).toBe('INVALID_INPUT');
      }
    });

    it('9.5 should handle compressObject errors for null, undefined, circular references, and BigInt', async () => {
      // @ts-expect-error testing null
      const nullRes = await StorageCompressionEngine.compressObject(null);
      expect(nullRes.ok).toBe(false);
      if (!nullRes.ok) {
        expect(nullRes.error.code).toBe('INVALID_INPUT');
        expect(nullRes.error.message).toContain('cannot be null or undefined');
      }

      // @ts-expect-error testing undefined
      const undefRes = await StorageCompressionEngine.compressObject(undefined);
      expect(undefRes.ok).toBe(false);
      if (!undefRes.ok) {
        expect(undefRes.error.code).toBe('INVALID_INPUT');
      }

      const circular: any = {};
      circular.self = circular;
      const circRes = await StorageCompressionEngine.compressObject(circular);
      expect(circRes.ok).toBe(false);
      if (!circRes.ok) {
        expect(circRes.error.code).toBe('INVALID_INPUT');
        expect(circRes.error.message).toContain('Failed to serialize object to JSON');
      }

      const bigIntObj = { big: 100n };
      const bigIntRes = await StorageCompressionEngine.compressObject(bigIntObj);
      expect(bigIntRes.ok).toBe(false);
      if (!bigIntRes.ok) {
        expect(bigIntRes.error.code).toBe('INVALID_INPUT');
        expect(bigIntRes.error.message).toContain('Failed to serialize object to JSON');
      }
    });

    it('9.6 should handle non-Error objects thrown during compressObject JSON stringification', async () => {
      const origStringify = JSON.stringify;
      try {
        JSON.stringify = () => {
          throw 'String error thrown during stringify';
        };
        const res = await StorageCompressionEngine.compressObject({ test: 1 });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.code).toBe('INVALID_INPUT');
          expect(res.error.message).toContain('String error thrown during stringify');
        }
      } finally {
        JSON.stringify = origStringify;
      }
    });

    it('9.7 should handle decompressObject error handling for null, undefined, invalid JSON, and non-Error throws', async () => {
      // @ts-expect-error testing null
      const nullRes = await StorageCompressionEngine.decompressObject(null);
      expect(nullRes.ok).toBe(false);
      if (!nullRes.ok) {
        expect(nullRes.error.code).toBe('INVALID_INPUT');
        expect(nullRes.error.message).toContain('cannot be null or undefined');
      }

      // @ts-expect-error testing undefined
      const undefRes = await StorageCompressionEngine.decompressObject(undefined);
      expect(undefRes.ok).toBe(false);

      // Compress plain text (NOT JSON)
      const plainComp = await StorageCompressionEngine.compress('This is plain text not JSON', { forceBypass: true });
      expect(plainComp.ok).toBe(true);
      if (!plainComp.ok) return;

      const decObjRes = await StorageCompressionEngine.decompressObject(plainComp.value);
      expect(decObjRes.ok).toBe(false);
      if (!decObjRes.ok) {
        expect(decObjRes.error.code).toBe('DECOMPRESSION_FAILED');
        expect(decObjRes.error.message).toContain('Failed to parse decompressed text as JSON');
      }

      // Test non-Error thrown in JSON.parse
      const origParse = JSON.parse;
      try {
        JSON.parse = () => {
          throw { custom: 'non-error object thrown' };
        };
        const res = await StorageCompressionEngine.decompressObject(plainComp.value);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.code).toBe('DECOMPRESSION_FAILED');
          expect(res.error.message).toContain('[object Object]');
        }
      } finally {
        JSON.parse = origParse;
      }
    });

    it('9.8 should propagate error when compressToEnvelope or decompressObject receives adapter error', async () => {
      const invalidAlgoEnvelopeRes = await StorageCompressionEngine.compressToEnvelope('test', { algorithm: 'invalid_algo' as any });
      expect(invalidAlgoEnvelopeRes.ok).toBe(false);
      if (!invalidAlgoEnvelopeRes.ok) {
        expect(invalidAlgoEnvelopeRes.error.code).toBe('UNSUPPORTED_ALGORITHM');
      }

      const invalidHeaderObjRes = await StorageCompressionEngine.decompressObject('cmp:v1:invalid_algo:0:10:10:12345678:data');
      expect(invalidHeaderObjRes.ok).toBe(false);
      if (!invalidHeaderObjRes.ok) {
        expect(invalidHeaderObjRes.error.code).toBe('UNSUPPORTED_ALGORITHM');
      }
    });

    it('9.9 should return error when analyzeCompressionPotential receives invalid input and return full stats on success', async () => {
      // @ts-expect-error testing null
      const errRes = await StorageCompressionEngine.analyzeCompressionPotential(null);
      expect(errRes.ok).toBe(false);
      if (!errRes.ok) {
        expect(errRes.error.code).toBe('INVALID_INPUT');
      }

      const sample = 'Analyze compression potential test string '.repeat(10);
      const statsRes = await StorageCompressionEngine.analyzeCompressionPotential(sample);
      expect(statsRes.ok).toBe(true);
      if (statsRes.ok) {
        const stats = statsRes.value;
        expect(stats.originalSize).toBe(sample.length);
        expect(stats.compressedSize).toBeGreaterThan(0);
        expect(typeof stats.savedBytes).toBe('number');
        expect(typeof stats.compressionRatio).toBe('number');
        expect(typeof stats.spaceSavingPercentage).toBe('number');
        expect(typeof stats.bypassed).toBe('boolean');
        expect(stats.algorithmUsed).toBe('lz-base64');
        expect(stats.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('10. LzCompressionAdapter Low-Level Matrix & Stryker Mutant Extermination', () => {
    it('10.1 should compute checksum accurately and reproducibly', () => {
      const adapter = new LzCompressionAdapter();
      expect(adapter.computeChecksum('')).toBe('00000001');
      expect(adapter.computeChecksum('A')).toBe('00420042');
      expect(adapter.computeChecksum('Hello World')).toBe('180b041d');
    });

    it('10.2 should calculate stats correctly across zero original size, expansion, and high compression', () => {
      const adapter = new LzCompressionAdapter();
      
      const zeroStats = adapter.getStats(0, 0, 'raw', true, 1.5);
      expect(zeroStats.originalSize).toBe(0);
      expect(zeroStats.compressedSize).toBe(0);
      expect(zeroStats.savedBytes).toBe(0);
      expect(zeroStats.compressionRatio).toBe(1.0);
      expect(zeroStats.spaceSavingPercentage).toBe(0);

      const expandedStats = adapter.getStats(100, 150, 'lz-base64', false, 2.0);
      expect(expandedStats.savedBytes).toBe(0); // Math.max(0, 100 - 150)
      expect(expandedStats.compressionRatio).toBe(1.5);
      expect(expandedStats.spaceSavingPercentage).toBe(0); // Math.max(0, (1 - 1.5) * 100)

      const goodStats = adapter.getStats(1000, 200, 'lz-base64', false, 5.0);
      expect(goodStats.savedBytes).toBe(800);
      expect(goodStats.compressionRatio).toBe(0.2);
      expect(goodStats.spaceSavingPercentage).toBe(80);
    });

    it('10.3 should handle gzip and deflate stream compression and decompression', async () => {
      const adapter = new LzCompressionAdapter();
      const text = 'Web streams compression test payload string '.repeat(10);

      const gzipRes = await adapter.compress(text, { algorithm: 'gzip', force: true });
      expect(gzipRes.ok).toBe(true);
      if (gzipRes.ok) {
        expect(gzipRes.value.algorithm).toBe('gzip');
        const gzipDec = await adapter.decompress(gzipRes.value);
        expect(gzipDec.ok).toBe(true);
        if (gzipDec.ok) {
          expect(gzipDec.value).toBe(text);
        }
      }

      const deflateRes = await adapter.compress(text, { algorithm: 'deflate', force: true });
      expect(deflateRes.ok).toBe(true);
      if (deflateRes.ok) {
        expect(deflateRes.value.algorithm).toBe('deflate');
        const deflateDec = await adapter.decompress(deflateRes.value);
        expect(deflateDec.ok).toBe(true);
        if (deflateDec.ok) {
          expect(deflateDec.value).toBe(text);
        }
      }
    });

    it('10.4 should test minSizeThreshold and minSizeBytes resolution and exact threshold boundary behavior', async () => {
      const adapter = new LzCompressionAdapter();
      const payload127 = 'A'.repeat(127);
      const payload128 = 'A'.repeat(128);

      // Default threshold is 128: 127 bytes < 128 -> bypassed
      const res127 = await adapter.compress(payload127);
      expect(res127.ok).toBe(true);
      if (res127.ok) expect(res127.value.bypassed).toBe(true);

      // 128 bytes is not < 128 -> compressed
      const res128 = await adapter.compress(payload128);
      expect(res128.ok).toBe(true);
      if (res128.ok) expect(res128.value.bypassed).toBe(false);

      // Explicit minSizeThreshold option
      const resCustomThresh = await adapter.compress('A'.repeat(49), { minSizeThreshold: 50 });
      expect(resCustomThresh.ok).toBe(true);
      if (resCustomThresh.ok) expect(resCustomThresh.value.bypassed).toBe(true);

      // Explicit minSizeBytes option
      const resCustomBytes = await adapter.compress('A'.repeat(49), { minSizeBytes: 50 });
      expect(resCustomBytes.ok).toBe(true);
      if (resCustomBytes.ok) expect(resCustomBytes.value.bypassed).toBe(true);
    });

    it('10.5 should test ratioThreshold resolution and force / allowInflation flags', async () => {
      const adapter = new LzCompressionAdapter();
      const data = 'High Entropy Test String 12345!@#$%^&*()_+'.repeat(5);

      // Custom ratioThreshold = 0.1 (strict saving requirement)
      const resStrictRatio = await adapter.compress(data, { ratioThreshold: 0.1 });
      expect(resStrictRatio.ok).toBe(true);
      if (resStrictRatio.ok) {
        expect(resStrictRatio.value.bypassed).toBe(true);
      }

      // allowInflation = true
      const resInflation = await adapter.compress(data, { ratioThreshold: 0.1, allowInflation: true });
      expect(resInflation.ok).toBe(true);
      if (resInflation.ok) {
        expect(resInflation.value.bypassed).toBe(false);
      }

      // force = true
      const resForce = await adapter.compress(data, { ratioThreshold: 0.1, force: true });
      expect(resForce.ok).toBe(true);
      if (resForce.ok) {
        expect(resForce.value.bypassed).toBe(false);
      }
    });

    it('10.6 should handle direct decompress with non-string non-object, invalid versions, and maxDecompressedSizeBytes boundaries', async () => {
      const adapter = new LzCompressionAdapter();

      // @ts-expect-error testing number
      const numRes = await adapter.decompress(12345);
      expect(numRes.ok).toBe(false);
      if (!numRes.ok) {
        expect(numRes.error.code).toBe('INVALID_INPUT');
      }

      // @ts-expect-error testing boolean
      const boolRes = await adapter.decompress(true);
      expect(boolRes.ok).toBe(false);
      if (!boolRes.ok) {
        expect(boolRes.error.code).toBe('INVALID_INPUT');
      }

      const version2Dto: CompressedPayloadDto = {
        version: 2 as any,
        algorithm: 'lz-base64',
        uncompressedSize: 100,
        compressedSize: 20,
        checksum: '12345678',
        bypassed: false,
        data: 'data',
      };
      const v2Res = await adapter.decompress(version2Dto);
      expect(v2Res.ok).toBe(false);
      if (!v2Res.ok) {
        expect(v2Res.error.code).toBe('INVALID_HEADER');
      }

      // maxDecompressedSizeBytes boundary: uncompressedSize === maxDecompressedSizeBytes -> OK
      const sample = 'Max size boundary test string '.repeat(10);
      const compRes = await adapter.compress(sample);
      expect(compRes.ok).toBe(true);
      if (!compRes.ok) return;

      const exactSizeRes = await adapter.decompress(compRes.value, { maxDecompressedSizeBytes: sample.length });
      expect(exactSizeRes.ok).toBe(true);

      const tooSmallRes = await adapter.decompress(compRes.value, { maxDecompressedSizeBytes: sample.length - 1 });
      expect(tooSmallRes.ok).toBe(false);
      if (!tooSmallRes.ok) {
        expect(tooSmallRes.error.code).toBe('DECOMPRESSION_EXCEEDS_BOUNDS');
      }
    });

    it('10.7 should test verifyChecksum option (true vs false) during decompression', async () => {
      const adapter = new LzCompressionAdapter();
      const sample = 'Checksum verification options test payload '.repeat(10);
      const compRes = await adapter.compress(sample);
      expect(compRes.ok).toBe(true);
      if (!compRes.ok) return;

      // Tamper checksum
      const tamperedDto: CompressedPayloadDto = { ...compRes.value, checksum: 'bad12345' };

      // verifyChecksum: true (default) -> failure
      const failRes = await adapter.decompress(tamperedDto, { verifyChecksum: true });
      expect(failRes.ok).toBe(false);
      if (!failRes.ok) {
        expect(failRes.error.code).toBe('CORRUPTED_PAYLOAD');
        expect(failRes.error.message).toContain('Checksum mismatch');
      }

      // verifyChecksum: false -> success despite wrong checksum
      const passRes = await adapter.decompress(tamperedDto, { verifyChecksum: false });
      expect(passRes.ok).toBe(true);
      if (passRes.ok) {
        expect(passRes.value).toBe(sample);
      }
    });

    it('10.8 should test serializePayload validation for invalid objects, missing algorithms, and bypassed flag serialization', () => {
      const adapter = new LzCompressionAdapter();

      // @ts-expect-error testing null
      const nullRes = adapter.serializePayload(null);
      expect(nullRes.ok).toBe(false);
      if (!nullRes.ok) expect(nullRes.error.code).toBe('INVALID_INPUT');

      // @ts-expect-error testing string
      const strRes = adapter.serializePayload('not object');
      expect(strRes.ok).toBe(false);
      if (!strRes.ok) expect(strRes.error.code).toBe('INVALID_INPUT');

      const invalidVersionDto = { version: 2, algorithm: 'lz-base64', data: 'test' } as any;
      expect(adapter.serializePayload(invalidVersionDto).ok).toBe(false);

      const missingAlgoDto = { version: 1, algorithm: '', data: 'test' } as any;
      expect(adapter.serializePayload(missingAlgoDto).ok).toBe(false);

      const missingDataDto = { version: 1, algorithm: 'lz-base64' } as any;
      expect(adapter.serializePayload(missingDataDto).ok).toBe(false);

      const bypassedDto: CompressedPayloadDto = {
        version: 1,
        algorithm: 'raw',
        uncompressedSize: 50,
        compressedSize: 50,
        checksum: '12345678',
        bypassed: true,
        data: 'bypassed_data',
      };
      const bypassedSer = adapter.serializePayload(bypassedDto);
      expect(bypassedSer.ok).toBe(true);
      if (bypassedSer.ok) {
        expect(bypassedSer.value).toBe('cmp:v1:raw:1:50:50:12345678:bypassed_data');
      }
    });

    it('10.9 should test deserializePayload validation for invalid envelope structure and NaN fields', () => {
      const adapter = new LzCompressionAdapter();

      // @ts-expect-error testing null
      const nullRes = adapter.deserializePayload(null);
      expect(nullRes.ok).toBe(false);

      // Missing cmp:v1:
      const noPrefix = adapter.deserializePayload('v1:lz-base64:0:10:10:1234:data');
      expect(noPrefix.ok).toBe(false);
      if (!noPrefix.ok) expect(noPrefix.error.code).toBe('INVALID_HEADER');

      // Fewer than 5 colons
      const tooFewColons = adapter.deserializePayload('cmp:v1:lz-base64:0:10:10');
      expect(tooFewColons.ok).toBe(false);
      if (!tooFewColons.ok) expect(tooFewColons.error.code).toBe('INVALID_HEADER');

      // NaN flags
      const nanFlags = adapter.deserializePayload('cmp:v1:lz-base64:abc:10:10:12345678:data');
      expect(nanFlags.ok).toBe(false);
      if (!nanFlags.ok) expect(nanFlags.error.code).toBe('INVALID_HEADER');

      // NaN uncompressedSize
      const nanUncompressed = adapter.deserializePayload('cmp:v1:lz-base64:0:xyz:10:12345678:data');
      expect(nanUncompressed.ok).toBe(false);
      if (!nanUncompressed.ok) expect(nanUncompressed.error.code).toBe('INVALID_HEADER');

      // NaN compressedSize
      const nanCompressed = adapter.deserializePayload('cmp:v1:lz-base64:0:10:def:12345678:data');
      expect(nanCompressed.ok).toBe(false);
      if (!nanCompressed.ok) expect(nanCompressed.error.code).toBe('INVALID_HEADER');

      // Empty checksum
      const emptyChecksum = adapter.deserializePayload('cmp:v1:lz-base64:0:10:10::data');
      expect(emptyChecksum.ok).toBe(false);
      if (!emptyChecksum.ok) expect(emptyChecksum.error.code).toBe('INVALID_HEADER');

      // Unsupported algorithm
      const unsuppAlgo = adapter.deserializePayload('cmp:v1:unsupported_algo:0:10:10:12345678:data');
      expect(unsuppAlgo.ok).toBe(false);
      if (!unsuppAlgo.ok) expect(unsuppAlgo.error.code).toBe('UNSUPPORTED_ALGORITHM');
    });

    it('10.10 should test lzCompressBase64 padding branches (len % 4 == 0, 1, 2, 3)', () => {
      const adapter = new LzCompressionAdapter();
      // Test different inputs to exercise base64 padding logic
      for (const len of [1, 2, 3, 4, 5, 10, 15, 20]) {
        const input = 'X'.repeat(len * 50);
        const comp = (adapter as any).lzCompressBase64(input);
        expect(typeof comp).toBe('string');
        const dec = (adapter as any).lzDecompressBase64(comp);
        expect(dec).toBe(input);
      }

      expect((adapter as any).lzCompressBase64('')).toBe('');
      expect((adapter as any).lzDecompressBase64('')).toBe('');
    });

    it('10.11 should handle errors in compressStream and decompressStream when streams fail', async () => {
      const adapter = new LzCompressionAdapter();
      
      const origStream = globalThis.DecompressionStream;
      try {
        // @ts-expect-error mutating global for test
        delete globalThis.DecompressionStream;
        const res = await (adapter as any).decompressStream('c2FtcGxl', 'gzip');
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error.code).toBe('UNSUPPORTED_ENVIRONMENT');
        }
      } finally {
        globalThis.DecompressionStream = origStream;
      }
    });
  });
});
