import { Result } from '../../../utils/result';
import { HmacSignerPort } from '../../domain/ports/secondary/hmacSignerPort';
import { CryptoError } from '../../domain/ports/secondary/cryptoPort';

export class HmacSignerAdapter implements HmacSignerPort {
  private get subtleCrypto(): SubtleCrypto {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      return globalThis.crypto.subtle;
    }
    throw new CryptoError(
      'UNSUPPORTED_ENVIRONMENT',
      'Web Crypto API (crypto.subtle) is not available in this environment'
    );
  }

  public async importSecretKey(secret: string): Promise<Result<CryptoKey, CryptoError>> {
    try {
      if (!secret || secret.length === 0) {
        return Result.err(
          new CryptoError('INVALID_KEY', 'HMAC secret key cannot be empty')
        );
      }

      const encoder = new TextEncoder();
      const keyBuffer = encoder.encode(secret);

      const key = await this.subtleCrypto.importKey(
        'raw',
        keyBuffer,
        {
          name: 'HMAC',
          hash: { name: 'SHA-256' },
        },
        false,
        ['sign', 'verify']
      );

      return Result.ok(key);
    } catch (err) {
      return Result.err(
        new CryptoError(
          'INVALID_KEY',
          `Failed to import HMAC secret key: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async sign(
    payload: string,
    secret: string | CryptoKey
  ): Promise<Result<string, CryptoError>> {
    try {
      if (payload === null || payload === undefined) {
        return Result.err(
          new CryptoError('INVALID_PAYLOAD_FORMAT', 'Payload cannot be null or undefined')
        );
      }

      let cryptoKey: CryptoKey;
      if (typeof secret === 'string') {
        const importRes = await this.importSecretKey(secret);
        if (!importRes.ok) return Result.err(importRes.error);
        cryptoKey = importRes.value;
      } else {
        cryptoKey = secret;
      }

      const encoder = new TextEncoder();
      const payloadBytes = encoder.encode(payload);

      const signatureBuffer = await this.subtleCrypto.sign('HMAC', cryptoKey, payloadBytes);
      const hexSignature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      return Result.ok(hexSignature);
    } catch (err) {
      return Result.err(
        new CryptoError(
          'ENCRYPTION_FAILED',
          `HMAC signing failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }

  public async verify(
    payload: string,
    signature: string,
    secret: string | CryptoKey
  ): Promise<Result<boolean, CryptoError>> {
    try {
      if (!payload || !signature) {
        return Result.ok(false);
      }

      // Hex validation
      if (!/^[0-9a-fA-F]+$/.test(signature) || signature.length % 2 !== 0) {
        return Result.ok(false);
      }

      let cryptoKey: CryptoKey;
      if (typeof secret === 'string') {
        const importRes = await this.importSecretKey(secret);
        if (!importRes.ok) return Result.err(importRes.error);
        cryptoKey = importRes.value;
      } else {
        cryptoKey = secret;
      }

      const sigBytes = new Uint8Array(
        signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []
      );

      const encoder = new TextEncoder();
      const payloadBytes = encoder.encode(payload);

      const isValid = await this.subtleCrypto.verify(
        'HMAC',
        cryptoKey,
        sigBytes,
        payloadBytes
      );

      return Result.ok(isValid);
    } catch (err) {
      return Result.err(
        new CryptoError(
          'TAMPER_DETECTED',
          `HMAC verification failed: ${err instanceof Error ? err.message : String(err)}`,
          err
        )
      );
    }
  }
}
