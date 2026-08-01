import { Result } from './result';
import { LzCompressionAdapter } from '../src/infrastructure/adapters/lzCompressionAdapter';
import {
  CompressionPort,
  CompressionOptions,
  DecompressionOptions,
  CompressionStats,
  CompressedPayloadDto,
  StorageCompressionError,
} from '../src/domain/ports/secondary/compressionPort';

export class StorageCompressionEngine {
  private static instance: CompressionPort = new LzCompressionAdapter();

  public static setAdapter(adapter: CompressionPort): void {
    StorageCompressionEngine.instance = adapter;
  }

  public static resetAdapter(): void {
    StorageCompressionEngine.instance = new LzCompressionAdapter();
  }

  public static async compress(
    input: string | Uint8Array,
    options?: CompressionOptions
  ): Promise<Result<CompressedPayloadDto, StorageCompressionError>> {
    if (input === null || input === undefined) {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Input payload cannot be null or undefined')
      );
    }

    let strInput: string;
    if (typeof input === 'string') {
      strInput = input;
    } else if (input instanceof Uint8Array) {
      strInput = Array.from(input, (b) => String.fromCharCode(b)).join('');
    } else {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Input payload must be a string or Uint8Array')
      );
    }

    return StorageCompressionEngine.instance.compress(strInput, options);
  }

  public static async decompress<T = string>(
    payload: CompressedPayloadDto | string,
    options?: DecompressionOptions
  ): Promise<Result<T, StorageCompressionError>> {
    if (payload === null || payload === undefined) {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Compressed payload cannot be null or undefined')
      );
    }

    const decRes = await StorageCompressionEngine.instance.decompress(payload, options);
    if (!decRes.ok) return Result.err(decRes.error);

    return Result.ok(decRes.value as unknown as T);
  }

  public static async compressObject<T>(
    obj: T,
    options?: CompressionOptions
  ): Promise<Result<CompressedPayloadDto, StorageCompressionError>> {
    if (obj === null || obj === undefined) {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Object to compress cannot be null or undefined')
      );
    }

    try {
      const jsonStr = JSON.stringify(obj);
      return StorageCompressionEngine.compress(jsonStr, options);
    } catch (err) {
      return Result.err(
        new StorageCompressionError(
          'INVALID_INPUT',
          `Failed to serialize object to JSON: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public static async decompressObject<T>(
    payload: CompressedPayloadDto | string,
    options?: DecompressionOptions
  ): Promise<Result<T, StorageCompressionError>> {
    if (payload === null || payload === undefined) {
      return Result.err(
        new StorageCompressionError('INVALID_INPUT', 'Compressed payload cannot be null or undefined')
      );
    }

    const decRes = await StorageCompressionEngine.instance.decompress(payload, options);
    if (!decRes.ok) return Result.err(decRes.error);

    try {
      const parsed = JSON.parse(decRes.value);
      return Result.ok(parsed as T);
    } catch (err) {
      return Result.err(
        new StorageCompressionError(
          'DECOMPRESSION_FAILED',
          `Failed to parse decompressed text as JSON: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public static serializePayload(
    payload: CompressedPayloadDto
  ): Result<string, StorageCompressionError> {
    return StorageCompressionEngine.instance.serializePayload(payload);
  }

  public static deserializePayload(
    serialized: string
  ): Result<CompressedPayloadDto, StorageCompressionError> {
    return StorageCompressionEngine.instance.deserializePayload(serialized);
  }

  public static isCompressed(data: string): boolean {
    if (!data || typeof data !== 'string') return false;
    const res = StorageCompressionEngine.instance.deserializePayload(data);
    return res.ok;
  }

  public static getCompressionRatio(payload: CompressedPayloadDto): number {
    if (!payload || payload.bypassed || !payload.uncompressedSize) {
      return 0;
    }
    const ratio = (payload.uncompressedSize - payload.compressedSize) / payload.uncompressedSize;
    return Math.max(0, ratio);
  }

  public static async compressToEnvelope(
    input: string,
    options?: CompressionOptions
  ): Promise<Result<string, StorageCompressionError>> {
    const compRes = await StorageCompressionEngine.compress(input, options);
    if (!compRes.ok) return Result.err(compRes.error);
    return StorageCompressionEngine.instance.serializePayload(compRes.value);
  }

  public static async decompressFromEnvelope<T = string>(
    envelope: string,
    options?: DecompressionOptions
  ): Promise<Result<T, StorageCompressionError>> {
    return StorageCompressionEngine.decompress<T>(envelope, options);
  }

  public static async analyzeCompressionPotential(
    input: string
  ): Promise<Result<CompressionStats, StorageCompressionError>> {
    const startTime = performance.now();
    const compRes = await StorageCompressionEngine.compress(input);
    const durationMs = performance.now() - startTime;

    if (!compRes.ok) return Result.err(compRes.error);
    const dto = compRes.value;

    const stats = StorageCompressionEngine.instance.getStats(
      dto.uncompressedSize,
      dto.compressedSize,
      dto.algorithm,
      dto.bypassed,
      durationMs
    );

    return Result.ok(stats);
  }
}
