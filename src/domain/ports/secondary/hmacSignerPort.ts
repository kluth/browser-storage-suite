import { Result } from '../../../../utils/result';
import { CryptoError } from './cryptoPort';

export interface HmacSignerPort {
  /**
   * Generates a hex-encoded HMAC-SHA-256 signature over payload using the secret key.
   */
  sign(
    payload: string,
    secret: string | CryptoKey
  ): Promise<Result<string, CryptoError>>;

  /**
   * Cryptographically verifies if the HMAC-SHA-256 signature matches the payload.
   */
  verify(
    payload: string,
    signature: string,
    secret: string | CryptoKey
  ): Promise<Result<boolean, CryptoError>>;

  /**
   * Imports a raw string secret into a Web Crypto CryptoKey for HMAC-SHA-256 operations.
   */
  importSecretKey(secret: string): Promise<Result<CryptoKey, CryptoError>>;
}
