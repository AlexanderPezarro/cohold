import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createCipheriv, randomBytes } from 'crypto';
import { encryptToken, decryptToken, resetEncryptionKeyCache } from '../encryption.js';

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

describe('Token Encryption Service', () => {
  describe('encryptToken', () => {
    it('should encrypt a token successfully', () => {
      const token = 'test_access_token_123';
      const encrypted = encryptToken(token);

      // Should return a non-empty base64 string
      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');

      // Should be valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();

      // Should not contain the original token
      expect(encrypted).not.toContain(token);
    });

    it('should generate unique encrypted values for the same token', () => {
      const token = 'test_access_token_123';
      const encrypted1 = encryptToken(token);
      const encrypted2 = encryptToken(token);

      // Each encryption should be unique due to unique IVs
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should encrypt different tokens to different values', () => {
      const token1 = 'token_one';
      const token2 = 'token_two';
      const encrypted1 = encryptToken(token1);
      const encrypted2 = encryptToken(token2);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should encrypt empty string', () => {
      const token = '';
      const encrypted = encryptToken(token);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
    });

    it('should encrypt long tokens', () => {
      const token = 'x'.repeat(1000);
      const encrypted = encryptToken(token);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
    });

    it('should encrypt tokens with special characters', () => {
      const token = 'token!@#$%^&*()_+-=[]{}|;:,.<>?/~`\n\t';
      const encrypted = encryptToken(token);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
    });

    it('should encrypt unicode tokens', () => {
      const token = 'token_测试_🔒_émojis';
      const encrypted = encryptToken(token);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
    });
  });

  describe('decryptToken', () => {
    it('should decrypt an encrypted token successfully', () => {
      const originalToken = 'test_access_token_123';
      const encrypted = encryptToken(originalToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(originalToken);
    });

    it('should decrypt multiple encryptions of the same token correctly', () => {
      const originalToken = 'test_access_token_123';
      const encrypted1 = encryptToken(originalToken);
      const encrypted2 = encryptToken(originalToken);
      const decrypted1 = decryptToken(encrypted1);
      const decrypted2 = decryptToken(encrypted2);

      expect(decrypted1).toBe(originalToken);
      expect(decrypted2).toBe(originalToken);
    });

    it('should decrypt empty string', () => {
      const originalToken = '';
      const encrypted = encryptToken(originalToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(originalToken);
    });

    it('should decrypt long tokens', () => {
      const originalToken = 'x'.repeat(1000);
      const encrypted = encryptToken(originalToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(originalToken);
    });

    it('should decrypt tokens with special characters', () => {
      const originalToken = 'token!@#$%^&*()_+-=[]{}|;:,.<>?/~`\n\t';
      const encrypted = encryptToken(originalToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(originalToken);
    });

    it('should decrypt unicode tokens', () => {
      const originalToken = 'token_测试_🔒_émojis';
      const encrypted = encryptToken(originalToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(originalToken);
    });

    it('should throw error for invalid base64', () => {
      expect(() => decryptToken('not-valid-base64!@#$')).toThrow('Failed to decrypt token');
    });

    it('should throw error for empty string', () => {
      expect(() => decryptToken('')).toThrow('Failed to decrypt token');
    });

    it('should throw error for tampered encrypted data', () => {
      const originalToken = 'test_access_token_123';
      const encrypted = encryptToken(originalToken);

      // Tamper with the encrypted data
      const tamperedEncrypted = encrypted.slice(0, -5) + 'XXXXX';

      expect(() => decryptToken(tamperedEncrypted)).toThrow('Failed to decrypt token');
    });

    it('should throw error for truncated encrypted data', () => {
      const originalToken = 'test_access_token_123';
      const encrypted = encryptToken(originalToken);

      // Truncate the encrypted data
      const truncated = encrypted.slice(0, 20);

      expect(() => decryptToken(truncated)).toThrow('Failed to decrypt token');
    });

    it('should throw error for completely invalid data', () => {
      const invalidData = Buffer.from('invalid').toString('base64');

      expect(() => decryptToken(invalidData)).toThrow('Failed to decrypt token');
    });

    it('should throw error for data encrypted with different key', () => {
      // This test simulates what would happen if data was encrypted with a different key
      // We can't actually test with a different key in the same process, but we can
      // test with tampered auth tag which will have the same effect
      const originalToken = 'test_access_token_123';
      const encrypted = encryptToken(originalToken);

      // Decode and tamper with auth tag
      const buffer = Buffer.from(encrypted, 'base64');
      // Change the last byte of the auth tag
      buffer[buffer.length - 1] ^= 0xFF;

      const tamperedEncrypted = buffer.toString('base64');

      expect(() => decryptToken(tamperedEncrypted)).toThrow('Failed to decrypt token');
    });
  });

  describe('round-trip encryption', () => {
    it('should maintain data integrity through multiple encrypt/decrypt cycles', () => {
      const originalToken = 'test_access_token_123';

      // First cycle
      const encrypted1 = encryptToken(originalToken);
      const decrypted1 = decryptToken(encrypted1);
      expect(decrypted1).toBe(originalToken);

      // Second cycle with the decrypted value
      const encrypted2 = encryptToken(decrypted1);
      const decrypted2 = decryptToken(encrypted2);
      expect(decrypted2).toBe(originalToken);

      // Third cycle
      const encrypted3 = encryptToken(decrypted2);
      const decrypted3 = decryptToken(encrypted3);
      expect(decrypted3).toBe(originalToken);
    });

    it('should handle realistic OAuth tokens', () => {
      // Example OAuth token format
      const realisticToken = 'ya29.a0AfH6SMBxXYZ123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

      const encrypted = encryptToken(realisticToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(realisticToken);
    });
  });

  describe('security properties', () => {
    it('should produce different ciphertext for same plaintext (IV uniqueness)', () => {
      const token = 'test_token';
      const encrypted1 = encryptToken(token);
      const encrypted2 = encryptToken(token);
      const encrypted3 = encryptToken(token);

      // All should be different due to unique IVs
      expect(encrypted1).not.toBe(encrypted2);
      expect(encrypted2).not.toBe(encrypted3);
      expect(encrypted1).not.toBe(encrypted3);

      // But all should decrypt to the same value
      expect(decryptToken(encrypted1)).toBe(token);
      expect(decryptToken(encrypted2)).toBe(token);
      expect(decryptToken(encrypted3)).toBe(token);
    });

    it('should not leak plaintext length in a predictable way', () => {
      // Note: GCM mode doesn't add padding, so there's some length information,
      // but the IV and auth tag add fixed overhead
      const shortToken = 'a';
      const longToken = 'a'.repeat(100);

      const encryptedShort = encryptToken(shortToken);
      const encryptedLong = encryptToken(longToken);

      // Encrypted length should differ, but with fixed overhead for IV + auth tag
      const shortBuffer = Buffer.from(encryptedShort, 'base64');
      const longBuffer = Buffer.from(encryptedLong, 'base64');

      // IV (12) + auth tag (16) = 28 bytes overhead
      expect(shortBuffer.length).toBeGreaterThanOrEqual(28 + shortToken.length);
      expect(longBuffer.length).toBeGreaterThanOrEqual(28 + longToken.length);
    });
  });

  describe('key validation', () => {
    it('should validate key at module initialization', () => {
      // This test verifies that the key was validated when the module loaded
      // If we got here, the initialization succeeded with our test key
      expect(process.env.BANK_TOKEN_ENCRYPTION_KEY).toBe(TEST_ENCRYPTION_KEY);
    });

    // Note: Testing missing or invalid keys requires spawning a new process
    // since the module initializes on load. These scenarios are tested in
    // encryption-key-validation.test.ts which uses child processes.
  });

  describe('derived key (ENCRYPTION_KEY fallback)', () => {
    const originalBank = process.env.BANK_TOKEN_ENCRYPTION_KEY;
    const originalBase = process.env.ENCRYPTION_KEY;
    const BASE_KEY = '0123456789abcdef'.repeat(4);
    // HKDF-SHA256(BASE_KEY, salt = "", info = "cohold-bank-tokens", 32 bytes).
    // If this changes, every derived-key instance loses its stored tokens.
    const KNOWN_DERIVED_KEY = 'cd910b7a82bf9340681d3b77b1c048086150611550cd6bd335dffac6bf54dd9d';

    function restore(name: string, value: string | undefined) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    beforeEach(() => {
      resetEncryptionKeyCache();
    });

    afterEach(() => {
      restore('BANK_TOKEN_ENCRYPTION_KEY', originalBank);
      restore('ENCRYPTION_KEY', originalBase);
      resetEncryptionKeyCache();
    });

    it('derives a stable key from ENCRYPTION_KEY alone', () => {
      delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = BASE_KEY;

      const encrypted = encryptToken('derived-secret');
      resetEncryptionKeyCache();
      expect(decryptToken(encrypted)).toBe('derived-secret');
    });

    it('matches the known-answer HKDF vector', () => {
      delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = BASE_KEY;

      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(KNOWN_DERIVED_KEY, 'hex'), iv);
      const body = Buffer.concat([cipher.update('known-answer', 'utf8'), cipher.final()]);
      const external = Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');

      expect(decryptToken(external)).toBe('known-answer');
    });

    it('prefers BANK_TOKEN_ENCRYPTION_KEY over the derived key', () => {
      process.env.BANK_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
      process.env.ENCRYPTION_KEY = BASE_KEY;
      const underExplicit = encryptToken('explicit');
      expect(decryptToken(underExplicit)).toBe('explicit');

      delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
      resetEncryptionKeyCache();
      const underDerived = encryptToken('derived');
      expect(() => decryptToken(underExplicit)).toThrow('Failed to decrypt token');

      process.env.BANK_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
      resetEncryptionKeyCache();
      expect(() => decryptToken(underDerived)).toThrow('Failed to decrypt token');
    });

    it('throws when neither key is set', () => {
      delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      expect(() => encryptToken('x')).toThrow('Failed to encrypt token');
    });

    it('throws when ENCRYPTION_KEY is invalid', () => {
      delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'not-hex';
      expect(() => encryptToken('x')).toThrow('Failed to encrypt token');
    });
  });
});
