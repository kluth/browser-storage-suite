import { Result } from '../../../utils/result';
import {
  CryptoPort,
  EncryptedPayloadDto,
  CryptoError,
  KeyDerivationOptions,
} from '../../domain/ports/secondary/cryptoPort';

function isCryptoError(err: unknown): err is CryptoError {
  return (
    err instanceof CryptoError ||
    (typeof err === 'object' && err !== null && (err as any).name === 'CryptoError' && typeof (err as any).code === 'string')
  );
}

export class AesCryptoAdapter implements CryptoPort {
  private static readonly DEFAULT_ITERATIONS = 100000;
  private static readonly DEFAULT_SALT_LENGTH = 16;
  private static readonly DEFAULT_IV_LENGTH = 12;
  private static readonly PAYLOAD_PREFIX = 'enc:v1:';

  private get subtleCrypto(): SubtleCrypto {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      return globalThis.crypto.subtle;
    }
    throw new CryptoError(
      'UNSUPPORTED_ENVIRONMENT',
      'Web Crypto API (crypto.subtle) is not available in this environment'
    );
  }

  private get getRandomValues(): (array: Uint8Array) => Uint8Array {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
      return (array: Uint8Array) => globalThis.crypto.getRandomValues(array);
    }
    throw new CryptoError(
      'UNSUPPORTED_ENVIRONMENT',
      'crypto.getRandomValues is not available in this environment'
    );
  }

  public async deriveKey(
    passphrase: string,
    salt: Uint8Array,
    options?: KeyDerivationOptions
  ): Promise<Result<CryptoKey, CryptoError>> {
    try {
      if (!passphrase || passphrase.length === 0) {
        return Result.err(
          new CryptoError('INVALID_PASSPHRASE', 'Passphrase cannot be empty')
        );
      }
      if (!salt || salt.length === 0) {
        return Result.err(
          new CryptoError('INVALID_KEY', 'Salt cannot be empty')
        );
      }

      const iterations = options?.iterations ?? AesCryptoAdapter.DEFAULT_ITERATIONS;
      const encoder = new TextEncoder();
      const passphraseBuffer = encoder.encode(passphrase);

      const baseKey = await this.subtleCrypto.importKey(
        'raw',
        passphraseBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
      );

      const saltBuffer = new Uint8Array(salt.byteLength);
      saltBuffer.set(salt);

      const derivedKey = await this.subtleCrypto.deriveKey(
        {
          name: 'PBKDF2',
          salt: saltBuffer,
          iterations,
          hash: 'SHA-256',
        },
        baseKey,
        {
          name: 'AES-GCM',
          length: 256,
        },
        true,
        ['encrypt', 'decrypt']
      );

      return Result.ok(derivedKey);
    } catch (err) {
      if (isCryptoError(err)) return Result.err(err);
      return Result.err(
        new CryptoError(
          'INVALID_KEY',
          `Key derivation failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async generateKey(): Promise<Result<CryptoKey, CryptoError>> {
    try {
      const key = await this.subtleCrypto.generateKey(
        {
          name: 'AES-GCM',
          length: 256,
        },
        true,
        ['encrypt', 'decrypt']
      );
      return Result.ok(key);
    } catch (err) {
      if (isCryptoError(err)) return Result.err(err);
      return Result.err(
        new CryptoError(
          'ENCRYPTION_FAILED',
          `Key generation failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async encrypt(
    plaintext: string,
    keyOrPassphrase: CryptoKey | string
  ): Promise<Result<EncryptedPayloadDto, CryptoError>> {
    try {
      if (plaintext === null || plaintext === undefined) {
        return Result.err(
          new CryptoError('ENCRYPTION_FAILED', 'Plaintext cannot be null or undefined')
        );
      }

      let cryptoKey: CryptoKey;
      let saltStr = '';

      if (typeof keyOrPassphrase === 'string') {
        const saltBytes = new Uint8Array(AesCryptoAdapter.DEFAULT_SALT_LENGTH);
        this.getRandomValues(saltBytes);
        const derivedRes = await this.deriveKey(keyOrPassphrase, saltBytes);
        if (!derivedRes.ok) return Result.err(derivedRes.error);
        cryptoKey = derivedRes.value;
        saltStr = this.uint8ArrayToBase64(saltBytes);
      } else {
        cryptoKey = keyOrPassphrase;
        saltStr = '';
      }

      const iv = new Uint8Array(AesCryptoAdapter.DEFAULT_IV_LENGTH);
      this.getRandomValues(iv);

      const encoder = new TextEncoder();
      const encodedPlaintext = encoder.encode(plaintext);

      const ivBuffer = new Uint8Array(iv.byteLength);
      ivBuffer.set(iv);

      const ciphertextArrayBuffer = await this.subtleCrypto.encrypt(
        {
          name: 'AES-GCM',
          iv: ivBuffer,
          tagLength: 128,
        },
        cryptoKey,
        encodedPlaintext
      );

      const ciphertextBytes = new Uint8Array(ciphertextArrayBuffer);

      const payload: EncryptedPayloadDto = {
        version: 1,
        salt: saltStr,
        iv: this.uint8ArrayToBase64(iv),
        ciphertext: this.uint8ArrayToBase64(ciphertextBytes),
      };

      return Result.ok(payload);
    } catch (err) {
      if (isCryptoError(err)) return Result.err(err);
      return Result.err(
        new CryptoError(
          'ENCRYPTION_FAILED',
          `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async decrypt(
    payloadOrSerialized: EncryptedPayloadDto | string,
    keyOrPassphrase: CryptoKey | string
  ): Promise<Result<string, CryptoError>> {
    try {
      let dto: EncryptedPayloadDto;
      if (typeof payloadOrSerialized === 'string') {
        const deserializedRes = this.deserializePayload(payloadOrSerialized);
        if (!deserializedRes.ok) return Result.err(deserializedRes.error);
        dto = deserializedRes.value;
      } else {
        dto = payloadOrSerialized;
      }

      if (!dto || dto.version !== 1) {
        return Result.err(
          new CryptoError('INVALID_PAYLOAD_FORMAT', 'Unsupported payload version')
        );
      }

      let cryptoKey: CryptoKey;
      if (typeof keyOrPassphrase === 'string') {
        if (dto.salt === '') {
          return Result.err(
            new CryptoError('INVALID_KEY', 'Passphrase provided but payload salt is missing')
          );
        }
        const saltBytesRes = this.base64ToUint8Array(dto.salt);
        if (!saltBytesRes.ok) return Result.err(saltBytesRes.error);
        const derivedRes = await this.deriveKey(keyOrPassphrase, saltBytesRes.value);
        if (!derivedRes.ok) return Result.err(derivedRes.error);
        cryptoKey = derivedRes.value;
      } else {
        cryptoKey = keyOrPassphrase;
      }

      const ivRes = this.base64ToUint8Array(dto.iv);
      if (!ivRes.ok) return Result.err(ivRes.error);

      const ciphertextRes = this.base64ToUint8Array(dto.ciphertext);
      if (!ciphertextRes.ok) return Result.err(ciphertextRes.error);

      const ivBuffer = new Uint8Array(ivRes.value.byteLength);
      ivBuffer.set(ivRes.value);

      const ciphertextBuffer = new Uint8Array(ciphertextRes.value.byteLength);
      ciphertextBuffer.set(ciphertextRes.value);

      const decryptedBuffer = await this.subtleCrypto.decrypt(
        {
          name: 'AES-GCM',
          iv: ivBuffer,
          tagLength: 128,
        },
        cryptoKey,
        ciphertextBuffer
      );

      const decoder = new TextDecoder();
      return Result.ok(decoder.decode(decryptedBuffer));
    } catch (err) {
      if (isCryptoError(err)) return Result.err(err);
      return Result.err(
        new CryptoError(
          'TAMPER_DETECTED',
          'Decryption failed: corrupted ciphertext, tampered tag, or invalid key',
          err
        )
      );
    }
  }

  public serializePayload(payload: EncryptedPayloadDto): Result<string, CryptoError> {
    if (!payload || payload.version !== 1 || !payload.iv || !payload.ciphertext) {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Invalid payload object for serialization')
      );
    }
    const formatted = `${AesCryptoAdapter.PAYLOAD_PREFIX}${payload.salt}:${payload.iv}:${payload.ciphertext}`;
    return Result.ok(formatted);
  }

  public deserializePayload(serialized: string): Result<EncryptedPayloadDto, CryptoError> {
    if (!serialized || typeof serialized !== 'string') {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Serialized input must be a non-empty string')
      );
    }

    if (!serialized.startsWith(AesCryptoAdapter.PAYLOAD_PREFIX)) {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Missing encryption payload header prefix')
      );
    }

    const body = serialized.slice(AesCryptoAdapter.PAYLOAD_PREFIX.length);
    const parts = body.split(':');
    if (parts.length !== 3) {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Invalid envelope format segments')
      );
    }

    const [salt, iv, ciphertext] = parts;
    if (salt === undefined || salt === null || !iv || !ciphertext) {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Empty required envelope segment')
      );
    }

    return Result.ok({
      version: 1,
      salt,
      iv,
      ciphertext,
    });
  }

  public disableBufferForTesting = false;

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    if (!this.disableBufferForTesting && typeof globalThis !== 'undefined' && globalThis.Buffer) {
      return globalThis.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return globalThis.btoa(binary);
  }

  private base64ToUint8Array(base64: string): Result<Uint8Array, CryptoError> {
    try {
      if (!this.disableBufferForTesting && typeof globalThis !== 'undefined' && globalThis.Buffer) {
        const buf = globalThis.Buffer.from(base64, 'base64');
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return Result.ok(bytes);
      }
      const binaryString = globalThis.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return Result.ok(bytes);
    } catch (err) {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Invalid base64 string decoding', err)
      );
    }
  }
}
