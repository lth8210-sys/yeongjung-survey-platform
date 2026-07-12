import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/kms.js', () => ({
  encryptField: vi.fn(async (plaintext) => `enc(${plaintext})`),
}));

const { needsMigration, buildProtectedFields } = await import('../scripts/migratePiiEncryption.mjs');

describe('needsMigration', () => {
  it('skips documents already marked piiProtected', () => {
    expect(needsMigration({ respondent: { piiProtected: true, applicantName: '홍길동' } })).toBe(false);
  });

  it('skips documents with no legacy PII at all', () => {
    expect(needsMigration({ respondent: {} })).toBe(false);
  });

  it('targets documents with legacy top-level respondentName', () => {
    expect(needsMigration({ respondentName: '홍길동', respondent: {} })).toBe(true);
  });

  it('targets documents with legacy respondent.applicantPhone', () => {
    expect(needsMigration({ respondent: { applicantPhone: '010-1234-5678' } })).toBe(true);
  });
});

describe('buildProtectedFields', () => {
  const KEY_NAME = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';

  it('masks and encrypts name/phone/birthDate from the legacy respondent map', async () => {
    const result = await buildProtectedFields(
      { applicantName: '홍길동', applicantPhone: '010-1234-5678', applicantBirthDate: '1990-01-01' },
      '',
      '',
      KEY_NAME,
    );

    expect(result.applicantNameMasked).toBe('홍*동');
    expect(result.applicantPhoneMasked).toBe('010-****-5678');
    expect(result.applicantBirthDateMasked).toBe('1990-**-**');
    expect(result.applicantPii).toEqual({
      name: 'enc(홍길동)',
      phone: 'enc(010-1234-5678)',
      birthDate: 'enc(1990-01-01)',
      keyVersion: KEY_NAME,
      encryptedAt: expect.any(String),
    });
    expect(result.piiProtected).toBe(true);
  });

  it('falls back to top-level respondentName/respondentPhone when respondent map lacks them', async () => {
    const result = await buildProtectedFields({}, '김철수', '010-9999-0000', KEY_NAME);
    expect(result.applicantNameMasked).toBe('김*수');
    expect(result.applicantPii.name).toBe('enc(김철수)');
  });

  it('leaves a field null when there is nothing to encrypt', async () => {
    const result = await buildProtectedFields({ applicantName: '홍길동' }, '', '', KEY_NAME);
    expect(result.applicantPii.phone).toBeNull();
    expect(result.applicantPii.birthDate).toBeNull();
    expect(result.applicantPhoneMasked).toBe('');
  });
});
