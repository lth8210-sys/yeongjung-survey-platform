import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const httpsCallableMock = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => httpsCallableMock(...args),
}));

vi.mock('../src/firebase/config.js', () => ({
  functionsClient: {},
  isFirebaseConfigured: true,
}));

const { protectRespondentPii, protectAnswerFields } = await import('../src/firebase/piiProtection.js');

// 2026-07 PII 보호 하드닝 회귀 테스트.
// 핵심 불변 조건: 암호화(Cloud Function 호출)가 실패해도 (a) 마스킹 미리보기는 항상 계산되고
// (b) 평문이 encrypted 필드에 대신 채워지는 일은 없어야 한다("암호화 실패 시 평문 저장 금지").
//
// 2026-07-14 추가: Cloud Functions가 실제로 배포되지 않은 채(Spark 플랜) 매 제출마다 존재하지
// 않는 엔드포인트를 호출하면 브라우저 콘솔에 CORS 오류가 남는다(원인 규명은
// docs/pii-encryption-architecture.md §11.13 참고) — VITE_ENABLE_PII_ENCRYPTION 플래그가
// "true"가 아니면(기본값) 네트워크 호출 자체를 시도하지 않는다. 아래 테스트는 그 값을
// 명시적으로 켠 상태에서만 실제 콜러블 호출 경로를 검증하고, 별도 describe에서 "꺼져 있으면
// 호출 자체가 없다"는 것을 고정한다.
describe('protectRespondentPii — VITE_ENABLE_PII_ENCRYPTION=true', () => {
  beforeEach(() => {
    httpsCallableMock.mockReset();
    vi.stubEnv('VITE_ENABLE_PII_ENCRYPTION', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns empty/unprotected result when no identity field is given', async () => {
    const result = await protectRespondentPii({});
    expect(result).toEqual({
      nameMasked: '',
      phoneMasked: '',
      birthDateMasked: '',
      encrypted: null,
      piiProtected: false,
    });
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it('always computes masked previews locally, independent of the network call', async () => {
    const callable = vi.fn(async () => ({
      data: {
        encrypted: { name: 'ct-name', phone: 'ct-phone', birthDate: null, keyVersion: 'v1', encryptedAt: 'now' },
      },
    }));
    httpsCallableMock.mockReturnValue(callable);

    const result = await protectRespondentPii({ name: '홍길동', phone: '010-1234-5678', birthDate: '' });

    expect(result.nameMasked).toBe('홍*동');
    expect(result.phoneMasked).toBe('010-****-5678');
    expect(result.piiProtected).toBe(true);
    expect(result.encrypted).toEqual({
      name: 'ct-name',
      phone: 'ct-phone',
      birthDate: null,
      keyVersion: 'v1',
      encryptedAt: 'now',
    });
    expect(callable).toHaveBeenCalledWith({ name: '홍길동', phone: '010-1234-5678', birthDate: '' });
  });

  it('falls back to masked-only (never plaintext) when the Cloud Function call throws', async () => {
    const callable = vi.fn(async () => {
      throw new Error('network down');
    });
    httpsCallableMock.mockReturnValue(callable);

    const result = await protectRespondentPii({ name: '홍길동', phone: '010-1234-5678', birthDate: '1990-01-01' });

    expect(result.piiProtected).toBe(false);
    expect(result.encrypted).toBeNull();
    // 실패했어도 마스킹 미리보기는 여전히 값이 있어야 한다(로컬 계산이라 네트워크와 무관).
    expect(result.nameMasked).toBe('홍*동');
    expect(result.phoneMasked).toBe('010-****-5678');
    expect(result.birthDateMasked).toBe('1990-**-**');
  });

  it('falls back to masked-only when the callable returns no encrypted payload', async () => {
    const callable = vi.fn(async () => ({ data: {} }));
    httpsCallableMock.mockReturnValue(callable);

    const result = await protectRespondentPii({ name: '홍길동' });
    expect(result.piiProtected).toBe(false);
    expect(result.encrypted).toBeNull();
  });
});

// Phase 2(2026-07): answers[] 내 자유서술형 PII 문항 보호. protectRespondentPii와 동일한 불변 조건 —
// 마스킹은 항상 로컬 계산, 암호화 실패 시에도 평문을 대신 저장하지 않는다.
describe('protectAnswerFields — VITE_ENABLE_PII_ENCRYPTION=true', () => {
  beforeEach(() => {
    httpsCallableMock.mockReset();
    vi.stubEnv('VITE_ENABLE_PII_ENCRYPTION', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns empty/unprotected result when there are no targets', async () => {
    const result = await protectAnswerFields([]);
    expect(result).toEqual({ maskedByQuestionId: {}, fields: null, piiProtected: false });
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it('always computes masked previews locally and sends raw values keyed by questionId', async () => {
    const callable = vi.fn(async () => ({
      data: {
        encrypted: {
          values: { 'q-name': 'ct-name', 'q-addr': 'ct-addr' },
          keyVersion: 'v1',
          encryptedAt: 'now',
          schemaVersion: 1,
        },
      },
    }));
    httpsCallableMock.mockReturnValue(callable);

    const result = await protectAnswerFields([
      { questionId: 'q-name', value: '홍길동', questionTitle: '이름', questionType: 'shortText' },
      { questionId: 'q-addr', value: '서울시 종로구 1번지', questionTitle: '상세 주소', questionType: 'longText' },
    ]);

    expect(result.maskedByQuestionId['q-name']).toBe('홍*동');
    expect(result.piiProtected).toBe(true);
    expect(result.fields).toEqual({
      values: { 'q-name': 'ct-name', 'q-addr': 'ct-addr' },
      keyVersion: 'v1',
      encryptedAt: 'now',
      schemaVersion: 1,
    });
    expect(callable).toHaveBeenCalledWith({
      fields: { 'q-name': '홍길동', 'q-addr': '서울시 종로구 1번지' },
    });
  });

  it('falls back to masked-only (never plaintext) when the Cloud Function call throws', async () => {
    const callable = vi.fn(async () => {
      throw new Error('network down');
    });
    httpsCallableMock.mockReturnValue(callable);

    const result = await protectAnswerFields([
      { questionId: 'q-name', value: '홍길동', questionTitle: '이름', questionType: 'shortText' },
    ]);

    expect(result.piiProtected).toBe(false);
    expect(result.fields).toBeNull();
    // 실패했어도 마스킹 미리보기는 여전히 값이 있어야 한다(로컬 계산이라 네트워크와 무관).
    expect(result.maskedByQuestionId['q-name']).toBe('홍*동');
  });
});

describe('protectRespondentPii/protectAnswerFields — VITE_ENABLE_PII_ENCRYPTION off (default)', () => {
  beforeEach(() => {
    httpsCallableMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('never calls the Cloud Function when the flag is unset — no CORS console noise from a nonexistent endpoint', async () => {
    const result = await protectRespondentPii({ name: '홍길동', phone: '010-1234-5678', birthDate: '1990-01-01' });

    expect(httpsCallableMock).not.toHaveBeenCalled();
    expect(result.piiProtected).toBe(false);
    expect(result.encrypted).toBeNull();
    // 마스킹 미리보기는 여전히 로컬에서 계산된다(네트워크와 무관).
    expect(result.nameMasked).toBe('홍*동');
    expect(result.phoneMasked).toBe('010-****-5678');
    expect(result.birthDateMasked).toBe('1990-**-**');
  });

  it('never calls the Cloud Function for answer fields when the flag is unset', async () => {
    const result = await protectAnswerFields([
      { questionId: 'q-name', value: '홍길동', questionTitle: '이름', questionType: 'shortText' },
    ]);

    expect(httpsCallableMock).not.toHaveBeenCalled();
    expect(result.piiProtected).toBe(false);
    expect(result.fields).toBeNull();
    expect(result.maskedByQuestionId['q-name']).toBe('홍*동');
  });

  it('still skips the network call when the flag is explicitly set to a non-"true" value', async () => {
    vi.stubEnv('VITE_ENABLE_PII_ENCRYPTION', 'false');
    const result = await protectRespondentPii({ name: '홍길동' });
    expect(httpsCallableMock).not.toHaveBeenCalled();
    expect(result.piiProtected).toBe(false);
  });
});
