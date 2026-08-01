import { Result } from '../../../../utils/result';

export type CompressionAlgorithm = 'lz-base64' | 'lz-utf16' | 'deflate' | 'gzip' | 'raw';

export interface CompressionOptions {
  algorithm?: CompressionAlgorithm;
  minSizeThreshold?: number; // Default: 128 bytes
  minSizeBytes?: number;     // Alias for minSizeThreshold
  ratioThreshold?: number;   // Default: 0.95 (95%)
  force?: boolean;           // Bypass threshold checks if true
  forceBypass?: boolean;     // Explicitly force bypass mode if true
  allowInflation?: boolean;  // Allow compression even if output expands
  signal?: AbortSignal;
}

export interface DecompressionOptions {
  verifyChecksum?: boolean;          // Default: true
  maxDecompressedSizeBytes?: number; // Guard against decompression bombs
}

export interface CompressionStats {
  originalSize: number;          // UTF-8 byte length
  compressedSize: number;        // UTF-8 byte length
  savedBytes: number;            // originalSize - compressedSize
  compressionRatio: number;      // compressedSize / originalSize
  spaceSavingPercentage: number; // (1 - compressionRatio) * 100
  bypassed: boolean;
  algorithmUsed: CompressionAlgorithm;
  durationMs: number;
}

export interface CompressedPayloadDto {
  version: number;               // Protocol version (1)
  algorithm: CompressionAlgorithm;
  uncompressedSize: number;
  compressedSize: number;
  checksum: string;              // 8-character hex string (Adler-32)
  data: string;                  // Encoded payload string
  bypassed: boolean;
}

export type StorageCompressionErrorCode =
  | 'INVALID_INPUT'
  | 'COMPRESSION_FAILED'
  | 'DECOMPRESSION_FAILED'
  | 'INVALID_HEADER'
  | 'CORRUPTED_PAYLOAD'
  | 'UNSUPPORTED_ALGORITHM'
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'DECOMPRESSION_EXCEEDS_BOUNDS'
  | 'OPERATION_ABORTED';

export class StorageCompressionError extends Error {
  constructor(
    public readonly code: StorageCompressionErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageCompressionError';
  }
}

export interface CompressionPort {
  compress(
    input: string,
    options?: CompressionOptions
  ): Promise<Result<CompressedPayloadDto, StorageCompressionError>>;

  decompress(
    payload: CompressedPayloadDto | string,
    options?: DecompressionOptions
  ): Promise<Result<string, StorageCompressionError>>;

  serializePayload(
    payload: CompressedPayloadDto
  ): Result<string, StorageCompressionError>;

  deserializePayload(
    serialized: string
  ): Result<CompressedPayloadDto, StorageCompressionError>;

  computeChecksum(input: string): string;

  getStats(
    originalSize: number,
    compressedSize: number,
    algorithm: CompressionAlgorithm,
    bypassed: boolean,
    durationMs: number
  ): CompressionStats;
}
