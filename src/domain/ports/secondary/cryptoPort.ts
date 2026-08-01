import { Result } from '../../../../utils/result';

export interface EncryptedPayloadDto {
  version: number;
  salt: string;       // Base64 encoded 16-byte salt
  iv: string;         // Base64 encoded 12-byte IV
  ciphertext: string; // Base64 encoded ciphertext including 16-byte authentication tag
}

export type CryptoErrorCode =
  | 'INVALID_KEY'
  | 'INVALID_PASSPHRASE'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'TAMPER_DETECTED'
  | 'INVALID_PAYLOAD_FORMAT'
  | 'UNSUPPORTED_ENVIRONMENT';

export class CryptoError extends Error {
  constructor(
    public readonly code: CryptoErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

export interface KeyDerivationOptions {
  iterations?: number;
  saltLength?: number;
}

export interface CryptoPort {
  deriveKey(
    passphrase: string,
    salt: Uint8Array,
    options?: KeyDerivationOptions
  ): Promise<Result<CryptoKey, CryptoError>>;

  generateKey(): Promise<Result<CryptoKey, CryptoError>>;

  encrypt(
    plaintext: string,
    keyOrPassphrase: CryptoKey | string
  ): Promise<Result<EncryptedPayloadDto, CryptoError>>;

  decrypt(
    payload: EncryptedPayloadDto | string,
    keyOrPassphrase: CryptoKey | string
  ): Promise<Result<string, CryptoError>>;

  serializePayload(payload: EncryptedPayloadDto): Result<string, CryptoError>;

  deserializePayload(serialized: string): Result<EncryptedPayloadDto, CryptoError>;
}
