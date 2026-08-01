import { Result } from './result';
import { AesCryptoAdapter } from '../src/infrastructure/adapters/aesCryptoAdapter';
import {
  CryptoPort,
  EncryptedPayloadDto,
  CryptoError,
  KeyDerivationOptions,
} from '../src/domain/ports/secondary/cryptoPort';

export class CryptoManager {
  private static instance: CryptoPort = new AesCryptoAdapter();

  public static setAdapter(adapter: CryptoPort): void {
    CryptoManager.instance = adapter;
  }

  public static resetAdapter(): void {
    CryptoManager.instance = new AesCryptoAdapter();
  }

  public static async deriveKey(
    passphrase: string,
    salt: Uint8Array,
    options?: KeyDerivationOptions
  ): Promise<Result<CryptoKey, CryptoError>> {
    return CryptoManager.instance.deriveKey(passphrase, salt, options);
  }

  public static async generateKey(): Promise<Result<CryptoKey, CryptoError>> {
    return CryptoManager.instance.generateKey();
  }

  public static async encrypt(
    plaintext: string,
    keyOrPassphrase: CryptoKey | string
  ): Promise<Result<string, CryptoError>> {
    const encRes = await CryptoManager.instance.encrypt(plaintext, keyOrPassphrase);
    if (!encRes.ok) return Result.err(encRes.error);
    return CryptoManager.instance.serializePayload(encRes.value);
  }

  public static async decrypt(
    encryptedData: string | EncryptedPayloadDto,
    keyOrPassphrase: CryptoKey | string
  ): Promise<Result<string, CryptoError>> {
    if (!encryptedData) {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Encrypted data cannot be null or undefined')
      );
    }
    return CryptoManager.instance.decrypt(encryptedData, keyOrPassphrase);
  }

  public static isEncrypted(data: string): boolean {
    if (!data || typeof data !== 'string') return false;
    const res = CryptoManager.instance.deserializePayload(data);
    return res.ok;
  }

  public static async rotateKeys(
    payloads: string[],
    oldPassphrase: string,
    newPassphrase: string
  ): Promise<Result<string[], CryptoError>> {
    if (!payloads || !Array.isArray(payloads)) {
      return Result.err(
        new CryptoError('INVALID_PAYLOAD_FORMAT', 'Payloads array cannot be null or non-array')
      );
    }
    const results: string[] = [];
    for (const payload of payloads) {
      const decRes = await CryptoManager.decrypt(payload, oldPassphrase);
      if (!decRes.ok) return Result.err(decRes.error);
      const encRes = await CryptoManager.encrypt(decRes.value, newPassphrase);
      if (!encRes.ok) return Result.err(encRes.error);
      results.push(encRes.value);
    }
    return Result.ok(results);
  }
}
