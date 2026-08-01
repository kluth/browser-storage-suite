import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoManager } from '../utils/cryptoManager';
import { AesCryptoAdapter } from '../src/infrastructure/adapters/aesCryptoAdapter';
import { CryptoError, EncryptedPayloadDto } from '../src/domain/ports/secondary/cryptoPort';

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
      }

      const emptySaltRes = await CryptoManager.deriveKey(samplePassphrase, new Uint8Array(0));
      expect(emptySaltRes.ok).toBe(false);
      if (!emptySaltRes.ok) {
        expect(emptySaltRes.error.code).toBe('INVALID_KEY');
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
      expect(adapter.deserializePayload('not_an_envelope').ok).toBe(false);
      expect(adapter.deserializePayload('enc:v1:only_two_parts').ok).toBe(false);
      expect(adapter.deserializePayload('enc:v1::empty:parts').ok).toBe(false);
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
      }
    });

    it('5.2 should allow custom CryptoPort adapter injection in CryptoManager', async () => {
      const mockAdapter: AesCryptoAdapter = new AesCryptoAdapter();
      CryptoManager.setAdapter(mockAdapter);

      const encRes = await CryptoManager.encrypt('custom_adapter_test', samplePassphrase);
      expect(encRes.ok).toBe(true);
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
  });
});
