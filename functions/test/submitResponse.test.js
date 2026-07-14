import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/kms.js', () => ({
  encryptField: vi.fn(async (plaintext) => `enc(${plaintext})`),
}));
vi.mock('../src/roles.js', () => ({
  resolveCallerRole: vi.fn(async (_db, auth) => ({ uid: auth.uid, role: 'viewer', status: 'active' })),
}));

const { encryptField } = await import('../src/kms.js');
const { resolveCallerRole } = await import('../src/roles.js');
const { handleSubmitProtectedSurveyResponse } = await import('../src/submitResponse.js');

const KEY_NAME = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';

// 실제 Firestore Admin SDK의 최소 동작(문서/서브컬렉션 경로, 트랜잭션 읽기-쓰기 순서, exists 여부)만
// 흉내 낸 인메모리 페이크. 진짜 원자성(동시 트랜잭션 충돌·재시도)은 검증하지 않는다 — 이 세션에는
// Firestore 에뮬레이터(Java)가 없어 그 부분은 운영자가 별도로 통합 테스트해야 한다(최종 보고 참조).
function createFakeFirestore(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs));

  function snapshotFor(path) {
    const data = store.get(path);
    return { exists: data !== undefined, id: path.split('/').pop(), data: () => (data ? { ...data } : undefined) };
  }

  function docRefFor(path) {
    return {
      __path: path,
      id: path.split('/').pop(),
      collection: (name) => collectionRefFor(`${path}/${name}`),
      get: async () => snapshotFor(path),
    };
  }

  function collectionRefFor(path) {
    return { doc: (id) => docRefFor(`${path}/${id}`) };
  }

  return {
    _store: store,
    collection: (name) => collectionRefFor(name),
    runTransaction: async (updateFn) => {
      const writes = [];
      const tx = {
        get: async (ref) => snapshotFor(ref.__path),
        set: (ref, data) => writes.push(['set', ref.__path, data]),
        update: (ref, data) => writes.push(['update', ref.__path, data]),
      };
      const result = await updateFn(tx);
      writes.forEach(([type, path, data]) => {
        if (type === 'set') {
          store.set(path, data);
        } else {
          store.set(path, { ...(store.get(path) ?? {}), ...data });
        }
      });
      return result;
    },
  };
}

function publishedSurvey(overrides = {}) {
  return {
    title: '테스트 설문',
    status: 'published',
    responseCount: 0,
    formType: 'general_survey',
    questions: [
      { id: 'q-opinion', title: '의견', type: 'longText' },
    ],
    ...overrides,
  };
}

describe('handleSubmitProtectedSurveyResponse', () => {
  beforeEach(() => {
    encryptField.mockClear();
    resolveCallerRole.mockClear();
  });

  it('rejects missing surveyId', async () => {
    const db = createFakeFirestore();
    await expect(
      handleSubmitProtectedSurveyResponse({ data: { clientSubmitId: 'c1', answers: [] }, auth: null, db, keyName: KEY_NAME }),
    ).rejects.toThrow(/surveyId/);
  });

  it('rejects missing clientSubmitId', async () => {
    const db = createFakeFirestore();
    await expect(
      handleSubmitProtectedSurveyResponse({ data: { surveyId: 's1', answers: [] }, auth: null, db, keyName: KEY_NAME }),
    ).rejects.toThrow(/clientSubmitId/);
  });

  it('rejects when the survey does not exist', async () => {
    const db = createFakeFirestore();
    await expect(
      handleSubmitProtectedSurveyResponse({
        data: { surveyId: 'missing', clientSubmitId: 'c1', answers: [] },
        auth: null,
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow('설문 정보를 찾을 수 없습니다.');
  });

  it('rejects a draft (unpublished) survey', async () => {
    const db = createFakeFirestore({ 'surveys/s1': publishedSurvey({ status: 'draft' }) });
    await expect(
      handleSubmitProtectedSurveyResponse({
        data: { surveyId: 's1', clientSubmitId: 'c1', answers: [] },
        auth: null,
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow('현재 응답을 받을 수 없는 설문입니다.');
  });

  it('accepts an anonymous submission on an open survey and increments responseCount', async () => {
    const db = createFakeFirestore({ 'surveys/s1': publishedSurvey() });

    const result = await handleSubmitProtectedSurveyResponse({
      data: {
        surveyId: 's1',
        clientSubmitId: 'c1',
        answers: [{ questionId: 'q-opinion', answer: '좋아요' }],
      },
      auth: null,
      db,
      keyName: KEY_NAME,
    });

    expect(result.responseId).toBeTruthy();
    const responseDoc = db._store.get(`responses/${result.responseId}`);
    expect(responseDoc.status).toBe('submitted');
    expect(responseDoc.answers).toHaveLength(1);
    expect(responseDoc.answers[0]).toMatchObject({ questionId: 'q-opinion', answer: '좋아요' });
    expect(db._store.get('surveys/s1').responseCount).toBe(1);
  });

  it('never trusts a client-claimed role/currentUserAccess field (not part of the accepted schema)', async () => {
    const db = createFakeFirestore({ 'surveys/s1': publishedSurvey() });

    await handleSubmitProtectedSurveyResponse({
      data: {
        surveyId: 's1',
        clientSubmitId: 'c1',
        answers: [],
        currentUserAccess: { role: 'super_admin', uid: 'attacker' },
      },
      auth: null,
      db,
      keyName: KEY_NAME,
    });

    // 익명 호출(auth: null)이므로 관리자 role 재계산 자체가 호출되지 않아야 한다 —
    // 즉 currentUserAccess.role='super_admin' 주장은 완전히 무시된다.
    expect(resolveCallerRole).not.toHaveBeenCalled();
  });

  it('replays the same clientSubmitId idempotently — same responseId, no double increment', async () => {
    const db = createFakeFirestore({ 'surveys/s1': publishedSurvey() });

    const first = await handleSubmitProtectedSurveyResponse({
      data: { surveyId: 's1', clientSubmitId: 'dup-1', answers: [] },
      auth: null,
      db,
      keyName: KEY_NAME,
    });
    const second = await handleSubmitProtectedSurveyResponse({
      data: { surveyId: 's1', clientSubmitId: 'dup-1', answers: [] },
      auth: null,
      db,
      keyName: KEY_NAME,
    });

    expect(second.responseId).toBe(first.responseId);
    expect(db._store.get('surveys/s1').responseCount).toBe(1);
  });

  it('blocks duplicate applications by phone when duplicateCheckEnabled', async () => {
    const db = createFakeFirestore({
      'surveys/s1': publishedSurvey({
        duplicateCheckEnabled: true,
        formType: 'general_application',
        questions: [{ id: 'q-phone', title: '연락처', type: 'phone' }],
      }),
    });
    const answers = [{ questionId: 'q-phone', answer: '010-1234-5678' }];

    await handleSubmitProtectedSurveyResponse({
      data: { surveyId: 's1', clientSubmitId: 'c1', answers },
      auth: null,
      db,
      keyName: KEY_NAME,
    });

    await expect(
      handleSubmitProtectedSurveyResponse({
        data: { surveyId: 's1', clientSubmitId: 'c2', answers },
        auth: null,
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow(/중복 신청/);
  });

  it('blocks submission once the age quota cell is closed (BLOCK mode)', async () => {
    const db = createFakeFirestore({
      'surveys/s1': publishedSurvey(),
      'surveys/s1/quotaConfig/main': {
        enabled: true,
        totalTarget: 10,
        baseYear: 2026,
        closeMode: 'block',
        ageGroups: [{ id: 'age_20_39', label: '20~39세', minAge: 20, maxAge: 39 }],
        targets: { age_20_39: 1 },
      },
      'surveys/s1/quotaCounts/main': { total: 1, cells: { age_20_39: 1 } },
    });

    await expect(
      handleSubmitProtectedSurveyResponse({
        data: { surveyId: 's1', clientSubmitId: 'c1', answers: [], quotaInput: { birthYear: 2000 } },
        auth: null,
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow(/마감/);
  });

  it('blocks submission once an option-quota (slot capacity) is full', async () => {
    const db = createFakeFirestore({
      'surveys/s1': publishedSurvey({
        formType: 'general_application',
        duplicateCheckEnabled: false,
        oneSlotPerPersonEnabled: false,
        slotDuplicateCheckEnabled: false,
        questions: [
          {
            id: 'q-slot',
            title: '희망 시간',
            type: 'singleChoice',
            options: ['오전', '오후'],
            optionSettings: { 오전: { capacity: 1 } },
          },
        ],
        optionQuotaCounts: { 'q-slot::오전': 1 },
      }),
    });

    await expect(
      handleSubmitProtectedSurveyResponse({
        data: { surveyId: 's1', clientSubmitId: 'c1', answers: [{ questionId: 'q-slot', answer: '오전' }] },
        auth: null,
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow(/마감/);
  });

  it('masks and encrypts identity fields and free-text PII answers, leaving demographic choice answers untouched', async () => {
    const db = createFakeFirestore({
      'surveys/s1': publishedSurvey({
        questions: [
          { id: 'q-name', title: '이름', type: 'shortText' },
          { id: 'q-age', title: '연령대', type: 'singleChoice', options: ['20대', '30대'] },
        ],
      }),
    });

    const result = await handleSubmitProtectedSurveyResponse({
      data: {
        surveyId: 's1',
        clientSubmitId: 'c1',
        answers: [
          { questionId: 'q-name', answer: '홍길동' },
          { questionId: 'q-age', answer: '20대' },
        ],
      },
      auth: null,
      db,
      keyName: KEY_NAME,
    });

    const responseDoc = db._store.get(`responses/${result.responseId}`);
    const nameAnswer = responseDoc.answers.find((a) => a.questionId === 'q-name');
    const ageAnswer = responseDoc.answers.find((a) => a.questionId === 'q-age');

    expect(nameAnswer.answer).toBe('홍*동');
    expect(nameAnswer.piiProtected).toBe(true);
    expect(ageAnswer.answer).toBe('20대'); // 통계용 선택형 문항은 원문 유지
    expect(responseDoc.respondent.applicantPii).toBeTruthy();
    expect(responseDoc.respondent.answersPii.values['q-name']).toBe('enc(홍길동)');
    // 위 두 "암호문" 필드(테스트 목 함수가 원문을 그대로 접두사에 담아 반환하므로 의도적으로 원문을
    // 포함함)를 제외한 나머지 저장 문서 전체에는 원문이 남아 있으면 안 된다.
    const { applicantPii: _applicantPii, answersPii: _answersPii, ...respondentWithoutCiphertext } = responseDoc.respondent;
    const docWithoutCiphertext = { ...responseDoc, respondent: respondentWithoutCiphertext };
    expect(JSON.stringify(docWithoutCiphertext)).not.toContain('홍길동');
  });

  it('retries KMS encryption automatically and succeeds after one transient failure', async () => {
    // 2026-07-14: 즉시 실패가 아니라 자동 재시도(1~2회) 후에도 실패할 때만 저장을 중단한다.
    // 첫 시도만 실패하고 재시도에서 성공하면 정상적으로 저장돼야 한다.
    encryptField.mockRejectedValueOnce(new Error('transient kms error'));
    const db = createFakeFirestore({
      'surveys/s1': publishedSurvey({ questions: [{ id: 'q-name', title: '이름', type: 'shortText' }] }),
    });

    const result = await handleSubmitProtectedSurveyResponse({
      data: { surveyId: 's1', clientSubmitId: 'c1', answers: [{ questionId: 'q-name', answer: '홍길동' }] },
      auth: null,
      db,
      keyName: KEY_NAME,
    });

    expect(result.responseId).toBeTruthy();
    const responseDoc = db._store.get(`responses/${result.responseId}`);
    expect(responseDoc.respondent.piiProtected).toBe(true);
    expect(responseDoc.respondent.applicantPii).toBeTruthy();
  });

  it('fails the entire submission (no response document written) when KMS encryption keeps failing after retries', async () => {
    encryptField.mockRejectedValue(new Error('kms down'));
    const db = createFakeFirestore({
      'surveys/s1': publishedSurvey({ questions: [{ id: 'q-name', title: '이름', type: 'shortText' }] }),
    });

    await expect(
      handleSubmitProtectedSurveyResponse({
        data: { surveyId: 's1', clientSubmitId: 'c1', answers: [{ questionId: 'q-name', answer: '홍길동' }] },
        auth: null,
        db,
        keyName: KEY_NAME,
      }),
    ).rejects.toThrow('일시적인 오류가 발생했습니다. 입력 내용은 유지되어 있습니다. 잠시 후 다시 제출해 주세요.');

    // 즉시 포기(1회)가 아니라 재시도했는지 확인한다. 이 픽스처는 "이름" 문항이 applicantIdentity
    // (신원 요약)와 answers[] PII 문항(자유서술형) 양쪽에서 동시에 암호화 대상이 되므로
    // (기존 설계 — 다른 테스트("masks and encrypts identity fields...")가 이미 이 이중 암호화를
    // 정상 동작으로 검증한다) 두 개의 독립된 재시도 루프가 병렬로 실행되어 정확한 호출 횟수는
    // 타이밍에 따라 달라진다 — 재시도가 일어났다는 사실(1회 초과)만 확인한다.
    expect(encryptField.mock.calls.length).toBeGreaterThan(1);
    expect([...db._store.keys()].some((path) => path.startsWith('responses/'))).toBe(false);
    expect(db._store.get('surveys/s1').responseCount).toBe(0);
  });
});

describe('verifyPiiPreservedBeforeSave', () => {
  it('passes when identity PII exists but is fully ciphertext-backed', async () => {
    const { verifyPiiPreservedBeforeSave } = await import('../src/submitResponse.js');
    const result = verifyPiiPreservedBeforeSave({
      applicantIdentity: { name: '홍길동', phone: '010-1234-5678', birthDate: '' },
      answerPiiQuestionIds: new Set(['q-name']),
      rawAnswers: [{ questionId: 'q-name', answer: '홍길동' }],
      piiResult: {
        applicantPii: { name: 'ct-name', phone: 'ct-phone' },
        protectedAnswers: [{ questionId: 'q-name', answer: '홍*동', piiProtected: true }],
      },
    });
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('fails when identity PII existed but no ciphertext was produced (Structure A forbids plaintext fallback)', async () => {
    const { verifyPiiPreservedBeforeSave } = await import('../src/submitResponse.js');
    const result = verifyPiiPreservedBeforeSave({
      applicantIdentity: { name: '홍길동', phone: '', birthDate: '' },
      answerPiiQuestionIds: new Set(),
      rawAnswers: [],
      piiResult: { applicantPii: null, protectedAnswers: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('applicantName');
  });

  it('fails when an answers[] PII question had an original value but was not marked piiProtected', async () => {
    const { verifyPiiPreservedBeforeSave } = await import('../src/submitResponse.js');
    const result = verifyPiiPreservedBeforeSave({
      applicantIdentity: {},
      answerPiiQuestionIds: new Set(['q-addr']),
      rawAnswers: [{ questionId: 'q-addr', answer: '서울시 종로구' }],
      piiResult: {
        applicantPii: null,
        protectedAnswers: [{ questionId: 'q-addr', answer: '서*시 **구', piiProtected: false }],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('answers.q-addr');
  });
});
