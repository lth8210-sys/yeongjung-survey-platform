import { describe, it, expect, afterEach, vi } from 'vitest';
import { encryptField, decryptField, __setClientForTest, resetClientForTest } from '../src/kms.js';

const KEY_NAME = 'projects/p/locations/asia-northeast3/keyRings/r/cryptoKeys/k';

describe('functions/src/kms.js', () => {
  afterEach(() => {
    resetClientForTest();
  });

  it('throws if keyName is missing (never falls back to a default key)', async () => {
    await expect(encryptField('secret', '')).rejects.toThrow('PII_KMS_KEY_NAME');
    await expect(decryptField('abc', '')).rejects.toThrow('PII_KMS_KEY_NAME');
  });

  it('encryptField calls KMS encrypt with a Buffer and base64-encodes the result', async () => {
    const encrypt = vi.fn(async ({ name, plaintext }) => {
      expect(name).toBe(KEY_NAME);
      expect(Buffer.isBuffer(plaintext)).toBe(true);
      expect(plaintext.toString('utf8')).toBe('홍길동');
      return [{ ciphertext: Buffer.from('fake-ciphertext') }];
    });
    __setClientForTest({ encrypt, decrypt: vi.fn() });

    const result = await encryptField('홍길동', KEY_NAME);
    expect(result).toBe(Buffer.from('fake-ciphertext').toString('base64'));
  });

  it('decryptField round-trips a base64 ciphertext back to plaintext', async () => {
    const decrypt = vi.fn(async ({ name, ciphertext }) => {
      expect(name).toBe(KEY_NAME);
      expect(ciphertext.toString('utf8')).toBe('fake-ciphertext');
      return [{ plaintext: Buffer.from('홍길동') }];
    });
    __setClientForTest({ encrypt: vi.fn(), decrypt });

    const result = await decryptField(Buffer.from('fake-ciphertext').toString('base64'), KEY_NAME);
    expect(result).toBe('홍길동');
  });

  it('surfaces an error if KMS returns no ciphertext', async () => {
    __setClientForTest({ encrypt: async () => [{}], decrypt: vi.fn() });
    await expect(encryptField('x', KEY_NAME)).rejects.toThrow('ciphertext');
  });
});
