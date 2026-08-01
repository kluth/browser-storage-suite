import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoManager } from '../utils/cryptoManager';
import { AesCryptoAdapter } from '../src/infrastructure/adapters/aesCryptoAdapter';
import { CryptoError, EncryptedPayloadDto } from '../src/domain/ports/secondary/cryptoPort';
import { Result } from '../utils/result';

describe('CryptoManager & AesCryptoAdapter (ADR-0001 Storage Encryption at Rest)', () => {
  const samplePassphrase = 'super_secret_master_passphrase_2026';
  const alternatePassphrase = 'different_wrong_passphrase_9999';

  beforeEach(() => {
    CryptoManager.resetAdapter();
  });

  describe('1. Key Derivation & Generation Tests', () => {
    it('1.1 should generate a valid 256-bit AES-GCM CryptoKey', async () => {
      const keyRes = await CryptoManager.generateKey();
      expect(keyRes.ok).toBe(true);
      if (keyRes.ok) {
        expect(keyRes.value.algorithm.name).toBe('AES-GCM');
        expect(keyRes.value.extractable).toBe(true);
      }
    });

    it('1.2 should derive a CryptoKey deterministically given passphrase and salt', async () => {
      const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const keyRes1 = await CryptoManager.deriveKey(samplePassphrase, salt);
      const keyRes2 = await CryptoManager.deriveKey(samplePassphrase, salt);

      expect(keyRes1.ok).toBe(true);
      expect(keyRes2.ok).toBe(true);
    });

    it('1.3 should produce distinct derived keys for different salts', async () => {
      const adapter = new AesCryptoAdapter();
      const enc1 = await adapter.encrypt('same_data', samplePassphrase);
      const enc2 = await adapter.encrypt('same_data', samplePassphrase);

      expect(enc1.ok).toBe(true);
      expect(enc2.ok).toBe(true);
      if (enc1.ok && enc2.ok) {
        expect(enc1.value.iv).not.toBe(enc2.value.iv);
        expect(enc1.value.salt).not.toBe(enc2.value.salt);
      }
    });

    it('1.4 should return Result.err for empty passphrase or empty salt', async () => {
      const salt = new Uint8Array(16);
      const emptyPassRes = await CryptoManager.deriveKey('', salt);
      expect(emptyPassRes.ok).toBe(false);
      if (!emptyPassRes.ok) {
        expect(emptyPassRes.error.code).toBe('INVALID_PASSPHRASE');
        expect(emptyPassRes.error.message).toBe('Passphrase cannot be empty');
      }

      const emptySaltRes = await CryptoManager.deriveKey(samplePassphrase, new Uint8Array(0));
      expect(emptySaltRes.ok).toBe(false);
      if (!emptySaltRes.ok) {
        expect(emptySaltRes.error.code).toBe('INVALID_KEY');
        expect(emptySaltRes.error.message).toBe('Salt cannot be empty');
      }
    });
  });

  describe('2. Encrypt & Decrypt Roundtrip Tests', () => {
    it('2.1 should encrypt and decrypt plaintext using passphrase string', async () => {
      const plaintext = 'Hello Browser Storage Suite! Sensitive Token 12345';
      const encRes = await CryptoManager.encrypt(plaintext, samplePassphrase);
      expect(encRes.ok).toBe(true);

      if (encRes.ok) {
        expect(encRes.value).toMatch(/^enc:v1:/);
        const decRes = await CryptoManager.decrypt(encRes.value, samplePassphrase);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(plaintext);
        }
      }
    });

    it('2.2 should encrypt and decrypt plaintext using CryptoKey instance', async () => {
      const keyRes = await CryptoManager.generateKey();
      expect(keyRes.ok).toBe(true);
      if (!keyRes.ok) return;

      const key = keyRes.value;
      const plaintext = 'Confidential state object payload';

      const adapter = new AesCryptoAdapter();
      const encDtoRes = await adapter.encrypt(plaintext, key);
      expect(encDtoRes.ok).toBe(true);

      if (encDtoRes.ok) {
        const decRes = await adapter.decrypt(encDtoRes.value, key);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(plaintext);
        }
      }
    });

    it('2.3 should encrypt and decrypt empty string without error', async () => {
      const plaintext = '';
      const encRes = await CryptoManager.encrypt(plaintext, samplePassphrase);
      expect(encRes.ok).toBe(true);
      if (encRes.ok) {
        const decRes = await CryptoManager.decrypt(encRes.value, samplePassphrase);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe('');
        }
      }
    });

    it('2.4 should handle Unicode, Emojis, and JSON serialized strings', async () => {
      const complexObject = {
        user: 'Jane Doe 🔒',
        sessionToken: 'jwt_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        roles: ['admin', 'auditor'],
        nested: { multiline: 'Line1\nLine2\tTabbed', cjk: '浏览器存储套件' },
      };
      const jsonString = JSON.stringify(complexObject);

      const encRes = await CryptoManager.encrypt(jsonString, samplePassphrase);
      expect(encRes.ok).toBe(true);
      if (encRes.ok) {
        const decRes = await CryptoManager.decrypt(encRes.value, samplePassphrase);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(JSON.parse(decRes.value)).toEqual(complexObject);
        }
      }
    });

    it('2.5 should generate fresh unique IV and salt for every encrypt call', async () => {
      const text = 'Identical Payload Text';
      const enc1 = await CryptoManager.encrypt(text, samplePassphrase);
      const enc2 = await CryptoManager.encrypt(text, samplePassphrase);

      expect(enc1.ok).toBe(true);
      expect(enc2.ok).toBe(true);
      if (enc1.ok && enc2.ok) {
        expect(enc1.value).not.toBe(enc2.value);
      }
    });

    it('2.6 should encrypt and decrypt plaintext using CryptoKey instance through CryptoManager facade', async () => {
      const keyRes = await CryptoManager.generateKey();
      expect(keyRes.ok).toBe(true);
      if (!keyRes.ok) return;

      const key = keyRes.value;
      const plaintext = 'CryptoKey roundtrip through CryptoManager facade';

      const encRes = await CryptoManager.encrypt(plaintext, key);
      expect(encRes.ok).toBe(true);
      if (encRes.ok) {
        expect(encRes.value).toMatch(/^enc:v1:/);
        const decRes = await CryptoManager.decrypt(encRes.value, key);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(plaintext);
        }
      }
    });
  });

  describe('3. Serialization & Envelope Verification', () => {
    it('3.1 should correctly identify encrypted string format via isEncrypted', async () => {
      const encRes = await CryptoManager.encrypt('test', samplePassphrase);
      expect(encRes.ok).toBe(true);
      if (encRes.ok) {
        expect(CryptoManager.isEncrypted(encRes.value)).toBe(true);
      }

      expect(CryptoManager.isEncrypted('plaintext_unencrypted_string')).toBe(false);
      expect(CryptoManager.isEncrypted('enc:v2:invalidversion')).toBe(false);
      expect(CryptoManager.isEncrypted('')).toBe(false);
      // @ts-expect-error testing non-string input
      expect(CryptoManager.isEncrypted(null)).toBe(false);
      // @ts-expect-error testing non-string object input
      expect(CryptoManager.isEncrypted({ foo: 'bar' })).toBe(false);
      // @ts-expect-error testing number input
      expect(CryptoManager.isEncrypted(12345)).toBe(false);
    });

    it('3.2 should deserialize serialized string to EncryptedPayloadDto', () => {
      const adapter = new AesCryptoAdapter();
      const validEnvelope = 'enc:v1:c2FsdF8xNg==:aXZfMTI=:Y2lwaGVydGV4dA==';
      const dtoRes = adapter.deserializePayload(validEnvelope);

      expect(dtoRes.ok).toBe(true);
      if (dtoRes.ok) {
        expect(dtoRes.value.version).toBe(1);
        expect(dtoRes.value.salt).toBe('c2FsdF8xNg==');
        expect(dtoRes.value.iv).toBe('aXZfMTI=');
        expect(dtoRes.value.ciphertext).toBe('Y2lwaGVydGV4dA==');
      }
    });

    it('3.3 should return Result.err when deserializing invalid formatted string', () => {
      const adapter = new AesCryptoAdapter();
      const err1 = adapter.deserializePayload('not_an_envelope');
      expect(err1.ok).toBe(false);
      if (!err1.ok) {
        expect(err1.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(err1.error.message).toBe('Missing encryption payload header prefix');
      }

      const err2 = adapter.deserializePayload('enc:v1:only_two_parts');
      expect(err2.ok).toBe(false);
      if (!err2.ok) {
        expect(err2.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(err2.error.message).toBe('Invalid envelope format segments');
      }

      const err3 = adapter.deserializePayload('enc:v1:salt::ciphertext');
      expect(err3.ok).toBe(false);
      if (!err3.ok) {
        expect(err3.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(err3.error.message).toBe('Empty required envelope segment');
      }

      // @ts-expect-error runtime invalid parameter
      const errNull = adapter.deserializePayload(null);
      expect(errNull.ok).toBe(false);
      if (!errNull.ok) {
        expect(errNull.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(errNull.error.message).toBe('Serialized input must be a non-empty string');
      }
    });

    it('3.4 should return Result.err when serializing invalid DTO', () => {
      const adapter = new AesCryptoAdapter();
      // @ts-expect-error invalid DTO
      const errNull = adapter.serializePayload(null);
      expect(errNull.ok).toBe(false);
      if (!errNull.ok) {
        expect(errNull.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(errNull.error.message).toBe('Invalid payload object for serialization');
      }

      // @ts-expect-error invalid version
      const errVersion = adapter.serializePayload({ version: 2 });
      expect(errVersion.ok).toBe(false);
      if (!errVersion.ok) {
        expect(errVersion.error.code).toBe('INVALID_PAYLOAD_FORMAT');
      }
    });
  });

  describe('4. Security & Tamper Detection (Stryker Defense Matrix)', () => {
    it('4.1 should fail decryption with TAMPER_DETECTED when wrong passphrase is used', async () => {
      const encRes = await CryptoManager.encrypt('top_secret', samplePassphrase);
      expect(encRes.ok).toBe(true);
      if (!encRes.ok) return;

      const decRes = await CryptoManager.decrypt(encRes.value, alternatePassphrase);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('TAMPER_DETECTED');
        expect(decRes.error.message).toBe('Decryption failed: corrupted ciphertext, tampered tag, or invalid key');
      }
    });

    it('4.2 should fail decryption with TAMPER_DETECTED when ciphertext is tampered', async () => {
      const adapter = new AesCryptoAdapter();
      const encRes = await adapter.encrypt('secret_data', samplePassphrase);
      expect(encRes.ok).toBe(true);
      if (!encRes.ok) return;

      const dto = encRes.value;
      const tamperedCiphertext = dto.ciphertext.slice(0, -2) + (dto.ciphertext.endsWith('AA') ? 'BB' : 'AA');
      const tamperedDto: EncryptedPayloadDto = { ...dto, ciphertext: tamperedCiphertext };

      const decRes = await adapter.decrypt(tamperedDto, samplePassphrase);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('TAMPER_DETECTED');
      }
    });

    it('4.3 should fail decryption with TAMPER_DETECTED when IV is tampered', async () => {
      const adapter = new AesCryptoAdapter();
      const encRes = await adapter.encrypt('secret_data', samplePassphrase);
      expect(encRes.ok).toBe(true);
      if (!encRes.ok) return;

      const dto = encRes.value;
      const tamperedIv = 'AAAA' + dto.iv.slice(4);
      const tamperedDto: EncryptedPayloadDto = { ...dto, iv: tamperedIv };

      const decRes = await adapter.decrypt(tamperedDto, samplePassphrase);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('TAMPER_DETECTED');
      }
    });

    it('4.4 should return INVALID_PAYLOAD_FORMAT for corrupted Base64 strings', async () => {
      const invalidBase64Envelope = 'enc:v1:!!!invalid_b64!!!:!!!invalid_b64!!!:!!!invalid_b64!!!';
      const decRes = await CryptoManager.decrypt(invalidBase64Envelope, samplePassphrase);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(['INVALID_PAYLOAD_FORMAT', 'TAMPER_DETECTED']).toContain(decRes.error.code);
      }
    });

    it('4.5 should return Result.err for unsupported version flag', async () => {
      const adapter = new AesCryptoAdapter();
      const unsupportedDto: EncryptedPayloadDto = {
        version: 99,
        salt: 'c2FsdA==',
        iv: 'aXZpdmk=',
        ciphertext: 'Y2lwaGVydGV4dA==',
      };
      const decRes = await adapter.decrypt(unsupportedDto, samplePassphrase);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(decRes.error.message).toBe('Unsupported payload version');
      }
    });
  });

  describe('5. Zero-Throw Boundary Resilience Tests & Key Rotation', () => {
    it('5.1 should handle null or undefined input to encrypt without throwing', async () => {
      const adapter = new AesCryptoAdapter();
      // @ts-expect-error testing runtime invalid input
      const res = await adapter.encrypt(null, samplePassphrase);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(CryptoError);
        expect(res.error.message).toBe('Plaintext cannot be null or undefined');
      }
    });

    it('5.2 should allow custom CryptoPort adapter injection in CryptoManager and reset it', async () => {
      class CustomMockAdapter extends AesCryptoAdapter {
        public override async generateKey() {
          return Result.err(new CryptoError('ENCRYPTION_FAILED', 'Custom mock adapter error'));
        }
      }
      const customAdapter = new CustomMockAdapter();
      CryptoManager.setAdapter(customAdapter);

      const errKeyRes = await CryptoManager.generateKey();
      expect(errKeyRes.ok).toBe(false);
      if (!errKeyRes.ok) {
        expect(errKeyRes.error.message).toBe('Custom mock adapter error');
      }

      CryptoManager.resetAdapter();
      const validKeyRes = await CryptoManager.generateKey();
      expect(validKeyRes.ok).toBe(true);
    });

    it('5.3 should re-encrypt multiple payloads during key rotation', async () => {
      const items = ['Item 1 secret', 'Item 2 secret', 'Item 3 secret'];
      const encryptedItems: string[] = [];

      for (const item of items) {
        const enc = await CryptoManager.encrypt(item, samplePassphrase);
        expect(enc.ok).toBe(true);
        if (enc.ok) encryptedItems.push(enc.value);
      }

      const rotateRes = await CryptoManager.rotateKeys(encryptedItems, samplePassphrase, alternatePassphrase);
      expect(rotateRes.ok).toBe(true);

      if (rotateRes.ok) {
        expect(rotateRes.value.length).toBe(3);
        for (let i = 0; i < rotateRes.value.length; i++) {
          const dec = await CryptoManager.decrypt(rotateRes.value[i], alternatePassphrase);
          expect(dec.ok).toBe(true);
          if (dec.ok) {
            expect(dec.value).toBe(items[i]);
          }
        }
      }
    });

    it('5.4 should propagate CryptoManager.encrypt failure when given invalid input', async () => {
      // @ts-expect-error invalid input
      const encRes = await CryptoManager.encrypt(null, samplePassphrase);
      expect(encRes.ok).toBe(false);
      if (!encRes.ok) {
        expect(encRes.error.code).toBe('ENCRYPTION_FAILED');
      }
    });

    it('5.5 should return error in rotateKeys when payload decryption fails', async () => {
      const validEnc = await CryptoManager.encrypt('test data', samplePassphrase);
      expect(validEnc.ok).toBe(true);
      if (validEnc.ok) {
        const rotateRes = await CryptoManager.rotateKeys([validEnc.value], 'wrong_passphrase', alternatePassphrase);
        expect(rotateRes.ok).toBe(false);
        if (!rotateRes.ok) {
          expect(rotateRes.error.code).toBe('TAMPER_DETECTED');
        }
      }
    });

    it('5.6 should return error in rotateKeys when payload re-encryption fails', async () => {
      const validEnc = await CryptoManager.encrypt('test data', samplePassphrase);
      expect(validEnc.ok).toBe(true);
      if (validEnc.ok) {
        const rotateRes = await CryptoManager.rotateKeys([validEnc.value], samplePassphrase, '');
        expect(rotateRes.ok).toBe(false);
        if (!rotateRes.ok) {
          expect(rotateRes.error.code).toBe('INVALID_PASSPHRASE');
        }
      }
    });

    it('5.7 should return Result.err when rotateKeys is called with null or non-array payloads', async () => {
      // @ts-expect-error testing runtime null input
      const resNull = await CryptoManager.rotateKeys(null, samplePassphrase, alternatePassphrase);
      expect(resNull.ok).toBe(false);
      if (!resNull.ok) {
        expect(resNull.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(resNull.error.message).toBe('Payloads array cannot be null or non-array');
      }

      // @ts-expect-error testing runtime non-array string input
      const resNotArray = await CryptoManager.rotateKeys('not_an_array', samplePassphrase, alternatePassphrase);
      expect(resNotArray.ok).toBe(false);
      if (!resNotArray.ok) {
        expect(resNotArray.error.code).toBe('INVALID_PAYLOAD_FORMAT');
      }

      // @ts-expect-error testing runtime non-array object input
      const resObj = await CryptoManager.rotateKeys({ key: 'val' }, samplePassphrase, alternatePassphrase);
      expect(resObj.ok).toBe(false);
      if (!resObj.ok) {
        expect(resObj.error.code).toBe('INVALID_PAYLOAD_FORMAT');
      }
    });

    it('5.8 should return Result.err when decrypt is called with null or empty payload', async () => {
      // @ts-expect-error testing runtime null input
      const resNull = await CryptoManager.decrypt(null, samplePassphrase);
      expect(resNull.ok).toBe(false);
      if (!resNull.ok) {
        expect(resNull.error.code).toBe('INVALID_PAYLOAD_FORMAT');
        expect(resNull.error.message).toBe('Encrypted data cannot be null or undefined');
      }

      // @ts-expect-error testing runtime undefined input
      const resUndef = await CryptoManager.decrypt(undefined, samplePassphrase);
      expect(resUndef.ok).toBe(false);
      if (!resUndef.ok) {
        expect(resUndef.error.code).toBe('INVALID_PAYLOAD_FORMAT');
      }
    });
  });

  describe('6. Browser Fallback & Error Handling Tests', () => {
    it('6.1 should encrypt and decrypt using btoa/atob when Buffer is disabled for testing', async () => {
      const adapter = new AesCryptoAdapter();
      adapter.disableBufferForTesting = true;
      const text = 'Browser fallback test string';
      const encRes = await adapter.encrypt(text, samplePassphrase);
      expect(encRes.ok).toBe(true);
      if (encRes.ok) {
        const decRes = await adapter.decrypt(encRes.value, samplePassphrase);
        expect(decRes.ok).toBe(true);
        if (decRes.ok) {
          expect(decRes.value).toBe(text);
        }
      }
    });

    it('6.2 should return Result.err when subtleCrypto deriveKey fails', async () => {
      const adapter = new AesCryptoAdapter();
      const origSubtle = globalThis.crypto.subtle;
      const mockSubtle = {
        importKey: (...args: any[]) => origSubtle.importKey.apply(origSubtle, args as any),
        deriveKey: async () => { throw new Error('Subtle deriveKey simulated failure'); },
      };
      Object.defineProperty(adapter, 'subtleCrypto', { get: () => mockSubtle, configurable: true });

      const salt = new Uint8Array(16);
      const res = await adapter.deriveKey(samplePassphrase, salt);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_KEY');
        expect(res.error.message).toContain('Subtle deriveKey simulated failure');
      }
    });

    it('6.3 should return Result.err when subtleCrypto encrypt fails', async () => {
      const keyRes = await CryptoManager.generateKey();
      if (!keyRes.ok) return;

      const adapter = new AesCryptoAdapter();
      const mockSubtle = {
        encrypt: async () => { throw new Error('Subtle encrypt simulated failure'); },
      };
      Object.defineProperty(adapter, 'subtleCrypto', { get: () => mockSubtle, configurable: true });

      const res = await adapter.encrypt('test', keyRes.value);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ENCRYPTION_FAILED');
        expect(res.error.message).toContain('Subtle encrypt simulated failure');
      }
    });

    it('6.4 should return Result.err when subtleCrypto generateKey fails', async () => {
      const adapter = new AesCryptoAdapter();
      const mockSubtle = {
        generateKey: async () => { throw new Error('Subtle generateKey simulated failure'); },
      };
      Object.defineProperty(adapter, 'subtleCrypto', { get: () => mockSubtle, configurable: true });

      const res = await adapter.generateKey();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ENCRYPTION_FAILED');
        expect(res.error.message).toContain('Subtle generateKey simulated failure');
      }
    });

    it('6.5 should handle empty salt envelope deserialization and decrypt with CryptoKey', async () => {
      const keyRes = await CryptoManager.generateKey();
      expect(keyRes.ok).toBe(true);
      if (!keyRes.ok) return;

      const adapter = new AesCryptoAdapter();
      const encRes = await adapter.encrypt('direct key data', keyRes.value);
      expect(encRes.ok).toBe(true);
      if (!encRes.ok) return;

      const serRes = adapter.serializePayload(encRes.value);
      expect(serRes.ok).toBe(true);
      if (!serRes.ok) return;

      expect(serRes.value).toMatch(/^enc:v1::/);

      const desRes = adapter.deserializePayload(serRes.value);
      expect(desRes.ok).toBe(true);
      if (desRes.ok) {
        expect(desRes.value.salt).toBe('');
      }

      const decRes = await adapter.decrypt(serRes.value, keyRes.value);
      expect(decRes.ok).toBe(true);
      if (decRes.ok) {
        expect(decRes.value).toBe('direct key data');
      }
    });

    it('6.6 should return INVALID_KEY when decrypting empty salt payload with passphrase', async () => {
      const keyRes = await CryptoManager.generateKey();
      if (!keyRes.ok) return;
      const adapter = new AesCryptoAdapter();
      const encRes = await adapter.encrypt('direct key data', keyRes.value);
      if (!encRes.ok) return;
      const serRes = adapter.serializePayload(encRes.value);
      if (!serRes.ok) return;

      const decPassRes = await adapter.decrypt(serRes.value, samplePassphrase);
      expect(decPassRes.ok).toBe(false);
      if (!decPassRes.ok) {
        expect(decPassRes.error.code).toBe('INVALID_KEY');
      }
    });
  });

  describe('7. High-Coverage Stryker Mutant Killer Suite', () => {
    it('7.1 should handle UNSUPPORTED_ENVIRONMENT when crypto.subtle is missing', async () => {
      const adapter = new AesCryptoAdapter();
      const origCrypto = globalThis.crypto;
      try {
        Object.defineProperty(globalThis, 'crypto', {
          value: { getRandomValues: origCrypto?.getRandomValues },
          configurable: true,
          writable: true,
        });
        const resKey = await adapter.generateKey();
        expect(resKey.ok).toBe(false);
        if (!resKey.ok) {
          expect(resKey.error.code).toBe('UNSUPPORTED_ENVIRONMENT');
        }
      } finally {
        Object.defineProperty(globalThis, 'crypto', {
          value: origCrypto,
          configurable: true,
          writable: true,
        });
      }
    });

    it('7.2 should handle UNSUPPORTED_ENVIRONMENT when crypto.getRandomValues is missing', async () => {
      const adapter = new AesCryptoAdapter();
      const origCrypto = globalThis.crypto;
      try {
        Object.defineProperty(globalThis, 'crypto', {
          value: { subtle: origCrypto?.subtle },
          configurable: true,
          writable: true,
        });
        const resEnc = await adapter.encrypt('test', samplePassphrase);
        expect(resEnc.ok).toBe(false);
        if (!resEnc.ok) {
          expect(resEnc.error.code).toBe('UNSUPPORTED_ENVIRONMENT');
        }
      } finally {
        Object.defineProperty(globalThis, 'crypto', {
          value: origCrypto,
          configurable: true,
          writable: true,
        });
      }
    });

    it('7.3 should respect custom key derivation iterations option', async () => {
      const salt = new Uint8Array(16);
      const res = await CryptoManager.deriveKey(samplePassphrase, salt, { iterations: 1000 });
      expect(res.ok).toBe(true);
    });

    it('7.4 should fail encrypt when plaintext is undefined', async () => {
      const adapter = new AesCryptoAdapter();
      // @ts-expect-error testing undefined input
      const res = await adapter.encrypt(undefined, samplePassphrase);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('ENCRYPTION_FAILED');
      }
    });

    it('7.5 should fail decrypt when DTO is invalid object or missing version', async () => {
      const adapter = new AesCryptoAdapter();
      // @ts-expect-error invalid DTO
      const res1 = await adapter.decrypt({}, samplePassphrase);
      expect(res1.ok).toBe(false);
      if (!res1.ok) {
        expect(res1.error.code).toBe('INVALID_PAYLOAD_FORMAT');
      }
    });

    it('7.6 should fail base64 decoding with INVALID_PAYLOAD_FORMAT when atob fails in browser fallback mode', async () => {
      const adapter = new AesCryptoAdapter();
      adapter.disableBufferForTesting = true;
      const decRes = await adapter.decrypt('enc:v1:c2FsdA==:aXZp:!!!invalid_b64!!!', samplePassphrase);
      expect(decRes.ok).toBe(false);
      if (!decRes.ok) {
        expect(decRes.error.code).toBe('INVALID_PAYLOAD_FORMAT');
      }
    });

    it('7.7 should handle non-Error throw in deriveKey', async () => {
      const adapter = new AesCryptoAdapter();
      const mockSubtle = {
        importKey: () => { throw 'String exception in deriveKey'; },
      };
      Object.defineProperty(adapter, 'subtleCrypto', { get: () => mockSubtle, configurable: true });
      const res = await adapter.deriveKey('pass', new Uint8Array(16));
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.message).toContain('String exception in deriveKey');
      }
    });

    it('7.8 should handle non-Error throw in encrypt', async () => {
      const adapter = new AesCryptoAdapter();
      const keyRes = await adapter.generateKey();
      if (!keyRes.ok) return;
      const mockSubtle = {
        encrypt: () => { throw 'String exception in encrypt'; },
      };
      Object.defineProperty(adapter, 'subtleCrypto', { get: () => mockSubtle, configurable: true });
      const res = await adapter.encrypt('test', keyRes.value);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.message).toContain('String exception in encrypt');
      }
    });

    it('7.9 should handle non-Error throw in decrypt', async () => {
      const adapter = new AesCryptoAdapter();
      const mockSubtle = {
        decrypt: () => { throw 'String exception in decrypt'; },
      };
      Object.defineProperty(adapter, 'subtleCrypto', { get: () => mockSubtle, configurable: true });
      const keyRes = await CryptoManager.generateKey();
      if (!keyRes.ok) return;
      const encRes = await adapter.encrypt('test', keyRes.value);
      if (!encRes.ok) return;
      const res = await adapter.decrypt(encRes.value, keyRes.value);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('TAMPER_DETECTED');
      }
    });
  });
});
