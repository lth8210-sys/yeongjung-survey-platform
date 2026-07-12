import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/kms.js', () => ({
  encryptField: vi.fn(async (plaintext) => `enc(${plaintext})`),
  decryptField: vi.fn(async (ciphertext) => ciphertext.replace(/^enc\((.*)\)$/, '$1')),
}));

const { encryptField, decryptField } = await import('../src/kms.js');
const {
  handleEncryptRespondentPii,
  handleEncryptAnswerFields,
  handleRevealResponsePii,
} = await import('../src/handlers.js');

const KEY_NAME = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';

describe('handleEncryptRespondentPii', () => {
  beforeEach(() => {
    encryptField.mockClear();
  });

  it('rejects when no PII field is provided', async () => {
    await expect(handleEncryptRespondentPii({ data: {}, keyName: KEY_NAME })).rejects.toThrow(
      /최소 하나가 필요/,
    );
  });

  it('encrypts only the fields that were provided', async () => {
    const result = await handleEncryptRespondentPii({
      data: { name: '홍길동', phone: '', birthDate: '1990-01-01' },
      keyName: KEY_NAME,
    });

    expect(result.encrypted.name).toBe('enc(홍길동)');
    expect(result.encrypted.phone).toBeNull();
    expect(result.encrypted.birthDate).toBe('enc(1990-01-01)');
    expect(result.encrypted.keyVersion).toBe(KEY_NAME);
    expect(encryptField).toHaveBeenCalledTimes(2);
  });

  it('wraps KMS failures as an internal error without leaking plaintext', async () => {
    encryptField.mockRejectedValueOnce(new Error('kms down'));
    await expect(
      handleEncryptRespondentPii({ data: { name: '홍길동' }, keyName: KEY_NAME }),
    ).rejects.toThrow('PII 암호화에 실패했습니다.');
  });
});

describe('handleEncryptAnswerFields', () => {
  beforeEach(() => {
    encryptField.mockClear();
  });

  it('rejects when fields is missing or empty', async () => {
    await expect(handleEncryptAnswerFields({ data: {}, keyName: KEY_NAME })).rejects.toThrow(
      /최소 하나의 값이 필요/,
    );
    await expect(
      handleEncryptAnswerFields({ data: { fields: {} }, keyName: KEY_NAME }),
    ).rejects.toThrow(/최소 하나의 값이 필요/);
  });

  it('encrypts every non-empty field, keyed by questionId', async () => {
    const result = await handleEncryptAnswerFields({
      data: { fields: { 'q-name': '홍길동', 'q-addr': '', 'q-birth': '1990-01-01' } },
      keyName: KEY_NAME,
    });

    expect(result.encrypted.values).toEqual({
      'q-name': 'enc(홍길동)',
      'q-birth': 'enc(1990-01-01)',
    });
    expect(result.encrypted.keyVersion).toBe(KEY_NAME);
    expect(result.encrypted.schemaVersion).toBe(1);
    expect(encryptField).toHaveBeenCalledTimes(2);
  });

  it('wraps KMS failures as an internal error without leaking plaintext', async () => {
    encryptField.mockRejectedValueOnce(new Error('kms down'));
    await expect(
      handleEncryptAnswerFields({ data: { fields: { 'q-name': '홍길동' } }, keyName: KEY_NAME }),
    ).rejects.toThrow('PII 암호화에 실패했습니다.');
  });
});

function makeFakeDb({ userData, responseData, existsResponse = true, existsUser = true }) {
  const auditLogs = [];
  return {
    _auditLogs: auditLogs,
    collection(name) {
      if (name === 'users') {
        return {
          doc: () => ({
            get: async () => ({ exists: existsUser, data: () => userData ?? {} }),
          }),
        };
      }
      if (name === 'responses') {
        return {
          doc: () => ({
            get: async () => ({ exists: existsResponse, data: () => responseData ?? {} }),
          }),
        };
      }
      if (name === 'audit_logs') {
        return {
          add: async (entry) => {
            auditLogs.push(entry);
            return { id: 'log-1' };
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

describe('handleRevealResponsePii', () => {
  beforeEach(() => {
    decryptField.mockClear();
  });

  it('rejects unauthenticated callers', async () => {
    const db = makeFakeDb({});
    await expect(
      handleRevealResponsePii({ data: { responseId: 'r1' }, auth: null, db, keyName: KEY_NAME }),
    ).rejects.toThrow('로그인이 필요합니다.');
  });

  it('rejects missing responseId', async () => {
    const db = makeFakeDb({});
    await expect(
      handleRevealResponsePii({ data: {}, auth: { uid: 'u1', token: {} }, db, keyName: KEY_NAME }),
    ).rejects.toThrow('responseId가 필요합니다.');
  });

  it('rejects when the response does not exist', async () => {
    const db = makeFakeDb({ existsResponse: false });
    await expect(
      handleRevealResponsePii({
        data: { responseId: 'r1' },
        auth: { uid: 'u1', token: { email: 'a@yeongjung.or.kr' } },
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow('응답을 찾을 수 없습니다.');
  });

  it('denies a viewer role', async () => {
    const db = makeFakeDb({
      userData: { role: 'viewer', status: 'active' },
      responseData: { surveyOwnerUid: 'someone-else' },
    });
    await expect(
      handleRevealResponsePii({
        data: { responseId: 'r1' },
        auth: { uid: 'u1', token: { email: 'viewer@yeongjung.or.kr' } },
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow('PII 열람 권한이 없습니다.');
  });

  it('denies a creator who does not own the survey', async () => {
    const db = makeFakeDb({
      userData: { role: 'creator', status: 'active' },
      responseData: { surveyOwnerUid: 'someone-else', respondent: { applicantPii: { name: 'enc(홍길동)' } } },
    });
    await expect(
      handleRevealResponsePii({
        data: { responseId: 'r1' },
        auth: { uid: 'u1', token: { email: 'creator@yeongjung.or.kr' } },
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow('PII 열람 권한이 없습니다.');
  });

  it('returns piiProtected:false when the response predates encryption (no applicantPii, no answersPii)', async () => {
    const db = makeFakeDb({
      userData: { role: 'admin', status: 'active' },
      responseData: { surveyOwnerUid: 'u1', respondent: {} },
    });
    const result = await handleRevealResponsePii({
      data: { responseId: 'r1' },
      auth: { uid: 'u1', token: { email: 'admin@yeongjung.or.kr' } },
      db,
      keyName: KEY_NAME,
    });
    expect(result).toEqual({ name: '', phone: '', birthDate: '', answers: {}, piiProtected: false });
    // 복호화할 것이 아예 없으면 KMS 호출도, 감사로그 기록도 하지 않는다.
    expect(decryptField).not.toHaveBeenCalled();
    expect(db._auditLogs).toHaveLength(0);
  });

  it('decrypts allowed fields, writes exactly one audit log entry, and never logs plaintext', async () => {
    const db = makeFakeDb({
      userData: { role: 'admin', status: 'active' },
      responseData: {
        surveyId: 's1',
        surveyOwnerUid: 'owner-uid',
        respondent: {
          applicantPii: { name: 'enc(홍길동)', phone: 'enc(010-1234-5678)', birthDate: null },
        },
      },
    });

    const result = await handleRevealResponsePii({
      data: { responseId: 'r1' },
      auth: { uid: 'admin-uid', token: { email: 'admin@yeongjung.or.kr' } },
      db,
      keyName: KEY_NAME,
    });

    expect(result).toEqual({
      name: '홍길동',
      phone: '010-1234-5678',
      birthDate: '',
      answers: {},
      piiProtected: true,
    });
    expect(db._auditLogs).toHaveLength(1);
    expect(db._auditLogs[0]).toMatchObject({
      action: 'pii_reveal',
      surveyId: 's1',
      responseId: 'r1',
      actor: { uid: 'admin-uid', email: 'admin@yeongjung.or.kr' },
    });
    expect(db._auditLogs[0].metadata.fields.sort()).toEqual(['name', 'phone']);
    // 감사로그 어디에도 복호화된 원문 값 자체는 없어야 한다.
    expect(JSON.stringify(db._auditLogs[0])).not.toContain('홍길동');
    expect(JSON.stringify(db._auditLogs[0])).not.toContain('010-1234-5678');
  });

  it('decrypts answers[] PII ciphertexts alongside identity fields and records both in the audit log', async () => {
    const db = makeFakeDb({
      userData: { role: 'admin', status: 'active' },
      responseData: {
        surveyId: 's1',
        surveyOwnerUid: 'owner-uid',
        respondent: {
          applicantPii: { name: 'enc(홍길동)', phone: null, birthDate: null },
          answersPii: {
            values: { 'q-addr': 'enc(서울시 종로구 1번지)' },
            keyVersion: KEY_NAME,
            encryptedAt: 'now',
            schemaVersion: 1,
          },
        },
      },
    });

    const result = await handleRevealResponsePii({
      data: { responseId: 'r1' },
      auth: { uid: 'admin-uid', token: { email: 'admin@yeongjung.or.kr' } },
      db,
      keyName: KEY_NAME,
    });

    expect(result.answers).toEqual({ 'q-addr': '서울시 종로구 1번지' });
    expect(result.piiProtected).toBe(true);
    expect(db._auditLogs[0].metadata.fields.sort()).toEqual(['answer:q-addr', 'name']);
    expect(JSON.stringify(db._auditLogs[0])).not.toContain('서울시 종로구 1번지');
  });

  it('decrypts answers[] PII even when there is no identity applicantPii at all', async () => {
    const db = makeFakeDb({
      userData: { role: 'admin', status: 'active' },
      responseData: {
        surveyId: 's1',
        surveyOwnerUid: 'owner-uid',
        respondent: {
          answersPii: { values: { 'q-addr': 'enc(서울시 종로구 1번지)' }, keyVersion: KEY_NAME },
        },
      },
    });

    const result = await handleRevealResponsePii({
      data: { responseId: 'r1' },
      auth: { uid: 'admin-uid', token: { email: 'admin@yeongjung.or.kr' } },
      db,
      keyName: KEY_NAME,
    });

    expect(result).toEqual({
      name: '',
      phone: '',
      birthDate: '',
      answers: { 'q-addr': '서울시 종로구 1번지' },
      piiProtected: true,
    });
  });

  it('allows a creator who owns the survey', async () => {
    const db = makeFakeDb({
      userData: { role: 'creator', status: 'active' },
      responseData: {
        surveyId: 's1',
        surveyOwnerUid: 'u1',
        respondent: { applicantPii: { name: 'enc(홍길동)' } },
      },
    });

    const result = await handleRevealResponsePii({
      data: { responseId: 'r1' },
      auth: { uid: 'u1', token: { email: 'creator@yeongjung.or.kr' } },
      db,
      keyName: KEY_NAME,
    });

    expect(result.piiProtected).toBe(true);
    expect(result.name).toBe('홍길동');
  });
});
