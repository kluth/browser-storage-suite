import { Result } from '../../../utils/result';
import {
  CompressionPort,
  CompressionOptions,
  DecompressionOptions,
  CompressionStats,
  CompressedPayloadDto,
  CompressionAlgorithm,
  StorageCompressionError,
} from '../../domain/ports/secondary/compressionPort';

export class LzCompressionAdapter implements CompressionPort {
  private static readonly PAYLOAD_PREFIX = 'cmp:v1:';
  private static readonly DEFAULT_MIN_SIZE_THRESHOLD = 128;
  private static readonly DEFAULT_RATIO_THRESHOLD = 0.95;

  public computeChecksum(input: string): string {
    let a = 1;
    let b = 0;
    const MOD = 65521;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input);
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % MOD;
      b = (b + a) % MOD;
    }
    const checksum = (b << 16) | a;
    return (checksum >>> 0).toString(16).padStart(8, '0');
  }

  public getStats(
    originalSize: number,
    compressedSize: number,
    algorithm: CompressionAlgorithm,
    bypassed: boolean,
    durationMs: number
  ): CompressionStats {
    const savedBytes = Math.max(0, originalSize - compressedSize);
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1.0;
    const spaceSavingPercentage = (1 - compressionRatio) * 100;

    return {
      originalSize,
      compressedSize,
      savedBytes,
      compressionRatio,
      spaceSavingPercentage: Math.max(0, spaceSavingPercentage),
      bypassed,
      algorithmUsed: algorithm,
      durationMs,
    };
  }

  public async compress(
    input: string,
    options?: CompressionOptions
  ): Promise<Result<CompressedPayloadDto, StorageCompressionError>> {
    const startTime = performance.now();

    if (options?.signal?.aborted) {
      return Result.err(
        new StorageCompressionError('OPERATION_ABORTED', 'Compression operation was aborted')
      );
    }

    if (input === null || input === undefined) {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Input string cannot be null or undefined')
      );
    }

    if (typeof input !== 'string') {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Input payload must be a string')
      );
    }

    const algorithm = options?.algorithm ?? 'lz-base64';
    const validAlgos: CompressionAlgorithm[] = ['lz-base64', 'lz-utf16', 'deflate', 'gzip', 'raw'];
    if (!validAlgos.includes(algorithm)) {
      return Result.err(
        new StorageCompressionError('UNSUPPORTED_ALGORITHM', `Algorithm ${algorithm} is not supported`)
      );
    }

    const encoder = new TextEncoder();
    const originalBytes = encoder.encode(input);
    const originalSize = originalBytes.length;
    const checksum = this.computeChecksum(input);

    if (options?.forceBypass) {
      return Result.ok({
        version: 1,
        algorithm: 'raw',
        uncompressedSize: originalSize,
        compressedSize: originalSize,
        checksum,
        data: input,
        bypassed: true,
      });
    }

    const minSizeThreshold = options?.minSizeThreshold ?? options?.minSizeBytes ?? LzCompressionAdapter.DEFAULT_MIN_SIZE_THRESHOLD;
    const ratioThreshold = options?.ratioThreshold ?? LzCompressionAdapter.DEFAULT_RATIO_THRESHOLD;
    const force = options?.force ?? false;
    const allowInflation = options?.allowInflation ?? false;

    // Automatic bypass check for small payloads (strictly less than minSizeThreshold)
    if (!force && originalSize < minSizeThreshold) {
      return Result.ok({
        version: 1,
        algorithm: 'raw',
        uncompressedSize: originalSize,
        compressedSize: originalSize,
        checksum,
        data: input,
        bypassed: true,
      });
    }

    try {
      let compressedData: string;

      if (algorithm === 'lz-base64') {
        compressedData = this.lzCompressBase64(input);
      } else if (algorithm === 'lz-utf16') {
        compressedData = this.lzCompressUtf16(input);
      } else if (algorithm === 'deflate' || algorithm === 'gzip') {
        const streamRes = await this.compressStream(originalBytes, algorithm);
        if (!streamRes.ok) return Result.err(streamRes.error);
        compressedData = streamRes.value;
      } else if (algorithm === 'raw') {
        compressedData = input;
      } else {
        return Result.err(
          new StorageCompressionError('UNSUPPORTED_ALGORITHM', `Algorithm ${algorithm} is not supported`)
        );
      }

      const compressedBytes = encoder.encode(compressedData);
      const compressedSize = compressedBytes.length;

      // Automatic bypass check if compression is unproductive
      if (!force && !allowInflation && algorithm !== 'raw' && compressedSize >= originalSize * ratioThreshold) {
        return Result.ok({
          version: 1,
          algorithm: 'raw',
          uncompressedSize: originalSize,
          compressedSize: originalSize,
          checksum,
          data: input,
          bypassed: true,
        });
      }

      return Result.ok({
        version: 1,
        algorithm,
        uncompressedSize: originalSize,
        compressedSize,
        checksum,
        data: compressedData,
        bypassed: algorithm === 'raw',
      });
    } catch (err) {
      return Result.err(
        new StorageCompressionError(
          'COMPRESSION_FAILED',
          `Compression failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async decompress(
    payloadOrSerialized: CompressedPayloadDto | string,
    options?: DecompressionOptions
  ): Promise<Result<string, StorageCompressionError>> {
    if (payloadOrSerialized === null || payloadOrSerialized === undefined) {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Compressed payload cannot be null or undefined')
      );
    }

    let dto: CompressedPayloadDto;

    if (typeof payloadOrSerialized === 'string') {
      const deserializeRes = this.deserializePayload(payloadOrSerialized);
      if (!deserializeRes.ok) return Result.err(deserializeRes.error);
      dto = deserializeRes.value;
    } else if (typeof payloadOrSerialized === 'object') {
      dto = payloadOrSerialized;
    } else {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Payload must be a string or CompressedPayloadDto object')
      );
    }

    if (!dto || dto.version !== 1) {
      return Result.err(
        new StorageCompressionError('INVALID_HEADER', 'Unsupported or missing compression payload version')
      );
    }

    if (options?.maxDecompressedSizeBytes && dto.uncompressedSize > options.maxDecompressedSizeBytes) {
      return Result.err(
        new StorageCompressionError(
          'DECOMPRESSION_EXCEEDS_BOUNDS',
          `Decompressed size ${dto.uncompressedSize} bytes exceeds maximum permitted size of ${options.maxDecompressedSizeBytes} bytes`
        )
      );
    }

    try {
      let decompressedText: string;

      if (dto.bypassed || dto.algorithm === 'raw') {
        decompressedText = dto.data;
      } else if (dto.algorithm === 'lz-base64') {
        decompressedText = this.lzDecompressBase64(dto.data);
      } else if (dto.algorithm === 'lz-utf16') {
        decompressedText = this.lzDecompressUtf16(dto.data);
      } else if (dto.algorithm === 'deflate' || dto.algorithm === 'gzip') {
        const streamRes = await this.decompressStream(dto.data, dto.algorithm);
        if (!streamRes.ok) return Result.err(streamRes.error);
        decompressedText = streamRes.value;
      } else {
        return Result.err(
          new StorageCompressionError('UNSUPPORTED_ALGORITHM', `Unsupported algorithm: ${dto.algorithm}`)
        );
      }

      if (decompressedText === null || decompressedText === undefined) {
        return Result.err(
          new StorageCompressionError('DECOMPRESSION_FAILED', 'Decompression yielded null or undefined')
        );
      }

      const verifyChecksum = options?.verifyChecksum ?? true;
      if (verifyChecksum) {
        const calculatedChecksum = this.computeChecksum(decompressedText);
        if (calculatedChecksum !== dto.checksum) {
          return Result.err(
            new StorageCompressionError(
              'CORRUPTED_PAYLOAD',
              `Checksum mismatch! Expected: ${dto.checksum}, Computed: ${calculatedChecksum}`
            )
          );
        }
      }

      return Result.ok(decompressedText);
    } catch (err) {
      return Result.err(
        new StorageCompressionError(
          'DECOMPRESSION_FAILED',
          `Decompression failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public serializePayload(payload: CompressedPayloadDto): Result<string, StorageCompressionError> {
    if (!payload || typeof payload !== 'object') {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Payload must be an object')
      );
    }

    if (payload.version !== 1 || !payload.algorithm || payload.data === undefined) {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Invalid payload object for serialization')
      );
    }

    const flags = payload.bypassed ? 1 : 0;
    const formatted = `${LzCompressionAdapter.PAYLOAD_PREFIX}${payload.algorithm}:${flags}:${payload.uncompressedSize}:${payload.compressedSize}:${payload.checksum}:${payload.data}`;
    return Result.ok(formatted);
  }

  public deserializePayload(serialized: string): Result<CompressedPayloadDto, StorageCompressionError> {
    if (serialized === null || serialized === undefined || typeof serialized !== 'string') {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Serialized envelope must be a non-empty string')
      );
    }

    if (!serialized.startsWith(LzCompressionAdapter.PAYLOAD_PREFIX)) {
      return Result.err(
        new StorageCompressionError('INVALID_HEADER', 'Missing or invalid compression header')
      );
    }

    const body = serialized.slice(LzCompressionAdapter.PAYLOAD_PREFIX.length);
    const firstColon = body.indexOf(':');
    const secondColon = body.indexOf(':', firstColon + 1);
    const thirdColon = body.indexOf(':', secondColon + 1);
    const fourthColon = body.indexOf(':', thirdColon + 1);
    const fifthColon = body.indexOf(':', fourthColon + 1);

    if (
      firstColon === -1 ||
      secondColon === -1 ||
      thirdColon === -1 ||
      fourthColon === -1 ||
      fifthColon === -1
    ) {
      return Result.err(
        new StorageCompressionError('INVALID_HEADER', 'Malformed compression header structure')
      );
    }

    const algoStr = body.slice(0, firstColon) as CompressionAlgorithm;
    const flagsStr = body.slice(firstColon + 1, secondColon);
    const uncompressedSizeStr = body.slice(secondColon + 1, thirdColon);
    const compressedSizeStr = body.slice(thirdColon + 1, fourthColon);
    const checksum = body.slice(fourthColon + 1, fifthColon);
    const data = body.slice(fifthColon + 1);

    const flags = parseInt(flagsStr, 10);
    const uncompressedSize = parseInt(uncompressedSizeStr, 10);
    const compressedSize = parseInt(compressedSizeStr, 10);

    if (isNaN(flags) || isNaN(uncompressedSize) || isNaN(compressedSize) || !checksum) {
      return Result.err(
        new StorageCompressionError('INVALID_HEADER', 'Invalid numeric metadata fields in envelope header')
      );
    }

    const validAlgos: CompressionAlgorithm[] = ['lz-base64', 'lz-utf16', 'deflate', 'gzip', 'raw'];
    if (!validAlgos.includes(algoStr)) {
      return Result.err(
        new StorageCompressionError('UNSUPPORTED_ALGORITHM', `Unsupported compression algorithm: ${algoStr}`)
      );
    }

    return Result.ok({
      version: 1,
      algorithm: algoStr,
      uncompressedSize,
      compressedSize,
      checksum,
      data,
      bypassed: flags === 1,
    });
  }

  // Web Streams API deflate/gzip
  private async compressStream(
    bytes: Uint8Array,
    format: 'deflate' | 'gzip'
  ): Promise<Result<string, StorageCompressionError>> {
    if (typeof globalThis.CompressionStream === 'undefined') {
      return Result.err(
        new StorageCompressionError(
          'UNSUPPORTED_ENVIRONMENT',
          `CompressionStream for algorithm '${format}' is not supported in this environment`
        )
      );
    }

    try {
      const cs = new CompressionStream(format);
      const writer = cs.writable.getWriter();
      writer.write(bytes as unknown as BufferSource);
      writer.close();

      const chunks: Uint8Array[] = [];
      const reader = cs.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const base64 = this.uint8ArrayToBase64(combined);
      return Result.ok(base64);
    } catch (err) {
      return Result.err(
        new StorageCompressionError(
          'COMPRESSION_FAILED',
          `Stream compression failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  private async decompressStream(
    base64Data: string,
    format: 'deflate' | 'gzip'
  ): Promise<Result<string, StorageCompressionError>> {
    if (typeof globalThis.DecompressionStream === 'undefined') {
      return Result.err(
        new StorageCompressionError(
          'UNSUPPORTED_ENVIRONMENT',
          `DecompressionStream for algorithm '${format}' is not supported in this environment`
        )
      );
    }

    try {
      const compressedBytes = this.base64ToUint8Array(base64Data);
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      writer.write(compressedBytes as unknown as BufferSource);
      writer.close();

      const chunks: Uint8Array[] = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const text = new TextDecoder().decode(combined);
      return Result.ok(text);
    } catch (err) {
      return Result.err(
        new StorageCompressionError(
          'DECOMPRESSION_FAILED',
          `Stream decompression failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  // Pure TypeScript LZ String Compression
  private lzCompressBase64(input: string): string {
    if (input === '') return '';
    const keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const res = this.lzCompressInternal(input, 6, (a) => keyStr.charAt(a));
    switch (res.length % 4) {
      case 1:
        return res + '===';
      case 2:
        return res + '==';
      case 3:
        return res + '=';
      default:
        return res;
    }
  }

  private lzDecompressBase64(input: string): string {
    if (!input) return '';
    const keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    return this.lzDecompressInternal(input.length, 32, (index) => keyStr.indexOf(input.charAt(index)));
  }

  private lzCompressUtf16(input: string): string {
    if (input === '') return '';
    return this.lzCompressInternal(input, 15, (a) => String.fromCharCode(a + 32)) + ' ';
  }

  private lzDecompressUtf16(input: string): string {
    if (!input) return '';
    return this.lzDecompressInternal(input.length, 16384, (index) => input.charCodeAt(index) - 32);
  }

  private lzCompressInternal(
    uncompressed: string,
    bitsPerChar: number,
    getCharFromInt: (a: number) => string
  ): string {
    if (uncompressed === null || uncompressed === undefined) return '';
    let i: number, value: number;
    const context_dictionary: Record<string, number> = {};
    const context_dictionaryToCreate: Record<string, boolean> = {};
    let context_c = '';
    let context_wc = '';
    let context_w = '';
    let context_enlargeIn = 2;
    let context_dictSize = 3;
    let context_numBits = 2;
    let context_data_val = 0;
    let context_data_position = 0;
    const output: string[] = [];

    for (let ii = 0; ii < uncompressed.length; ii++) {
      context_c = uncompressed.charAt(ii);
      if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
        context_dictionary[context_c] = context_dictSize++;
        context_dictionaryToCreate[context_c] = true;
      }

      context_wc = context_w + context_c;
      if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
        context_w = context_wc;
      } else {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
          if (context_w.charCodeAt(0) < 256) {
            for (i = 0; i < context_numBits; i++) {
              context_data_val = context_data_val << 1;
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                output.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
            }
            value = context_w.charCodeAt(0);
            for (i = 0; i < 8; i++) {
              context_data_val = (context_data_val << 1) | (value & 1);
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                output.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          } else {
            value = 1;
            for (i = 0; i < context_numBits; i++) {
              context_data_val = (context_data_val << 1) | value;
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                output.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = 0;
            }
            value = context_w.charCodeAt(0);
            for (i = 0; i < 16; i++) {
              context_data_val = (context_data_val << 1) | (value & 1);
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                output.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          }
          context_enlargeIn--;
          if (context_enlargeIn === 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          delete context_dictionaryToCreate[context_w];
        } else {
          value = context_dictionary[context_w];
          for (i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              output.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        context_dictionary[context_wc] = context_dictSize++;
        context_w = String(context_c);
      }
    }

    if (context_w !== '') {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
        if (context_w.charCodeAt(0) < 256) {
          for (i = 0; i < context_numBits; i++) {
            context_data_val = context_data_val << 1;
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              output.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 8; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              output.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        } else {
          value = 1;
          for (i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              output.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 16; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              output.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            output.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
    }

    // End of stream marker
    value = 2;
    for (i = 0; i < context_numBits; i++) {
      context_data_val = (context_data_val << 1) | (value & 1);
      if (context_data_position === bitsPerChar - 1) {
        context_data_position = 0;
        output.push(getCharFromInt(context_data_val));
        context_data_val = 0;
      } else {
        context_data_position++;
      }
      value = value >> 1;
    }

    // Flush remaining buffer
    while (true) {
      context_data_val = context_data_val << 1;
      if (context_data_position === bitsPerChar - 1) {
        output.push(getCharFromInt(context_data_val));
        break;
      } else {
        context_data_position++;
      }
    }
    return output.join('');
  }

  private lzDecompressInternal(
    length: number,
    resetValue: number,
    getNextValue: (index: number) => number
  ): string {
    const dictionary: string[] = [];
    let next: number;
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    let entry = '';
    const result: string[] = [];
    let w: string;
    let bits: number;
    let resb: number;
    let maxpower: number;
    let power: number;
    let c: string;
    const data = { val: getNextValue(0), position: resetValue, index: 1 };

    for (let i = 0; i < 3; i++) {
      dictionary[i] = String(i);
    }

    bits = 0;
    maxpower = Math.pow(2, 2);
    power = 1;
    while (power !== maxpower) {
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    switch (bits) {
      case 0:
        bits = 0;
        maxpower = Math.pow(2, 8);
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        c = String.fromCharCode(bits);
        break;
      case 1:
        bits = 0;
        maxpower = Math.pow(2, 16);
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        c = String.fromCharCode(bits);
        break;
      case 2:
        return '';
      default:
        return '';
    }

    dictionary[3] = c;
    w = c;
    result.push(c);

    while (true) {
      if (data.index > length) {
        return '';
      }

      bits = 0;
      maxpower = Math.pow(2, numBits);
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }

      switch ((next = bits)) {
        case 0:
          bits = 0;
          maxpower = Math.pow(2, 8);
          power = 1;
          while (power !== maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = String.fromCharCode(bits);
          next = dictSize - 1;
          enlargeIn--;
          break;
        case 1:
          bits = 0;
          maxpower = Math.pow(2, 16);
          power = 1;
          while (power !== maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = String.fromCharCode(bits);
          next = dictSize - 1;
          enlargeIn--;
          break;
        case 2:
          return result.join('');
      }

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      if (dictionary[next]) {
        entry = dictionary[next];
      } else {
        if (next === dictSize) {
          entry = w + w.charAt(0);
        } else {
          return '';
        }
      }
      result.push(entry);

      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;

      w = entry;

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
    }
  }
}
