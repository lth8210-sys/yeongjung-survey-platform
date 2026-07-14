import { describe, it, expect } from 'vitest';
import {
  resolveProtectedAnswerItem,
  buildRespondentPiiFields,
  isOriginalPiiLost,
  extractApplicationResponseSummary,
} from '../src/firebase/surveys.js';
import { QUESTION_TYPES } from '../src/firebase/surveyConstants.js';
import { maskName, maskPhone } from '../src/utils/privacy.js';

// 2026-07-14 회귀 테스트: 관리자 응답 다운로드 개인정보 원본 복구 결함
// (docs/admin-original-pii-export-fix.md 참고).
//
// 핵심 결함: 2026-07-12 커밋(feat(security): prepare protected survey response architecture)
// 이후 Cloud Functions(KMS 암호화)가 Spark 플랜으로 배포되지 않은 상태에서, encryptRespondentPii/
// encryptAnswerFields 호출이 항상 실패하는데도 원문 대신 마스킹값만 저장하도록 되어 있어
// 원본이 영구 유실됐다. 이 두 순수 함수(resolveProtectedAnswerItem, buildRespondentPiiFields)가
// 그 저장 판단 로직 전체다 — "암호화가 실제로 성공했을 때만 마스킹값을 저장하고, 그렇지 않으면
// 원문을 그대로 저장한다"는 불변조건을 여기서 고정한다.

const piiQuestionIds = new Set(['q-name', 'q-birth']);

describe('resolveProtectedAnswerItem', () => {
  it('passes through answer items for non-PII questions unchanged', () => {
    const item = { questionId: 'q-region', answer: '서울' };
    expect(resolveProtectedAnswerItem(item, piiQuestionIds, { maskedByQuestionId: {}, fields: null })).toBe(item);
  });

  it('keeps the original plaintext answer when encryption produced no ciphertext (Cloud Functions unavailable)', () => {
    const item = { questionId: 'q-name', answer: '홍길동' };
    const answerFieldsPii = { maskedByQuestionId: { 'q-name': '홍*동' }, fields: null };

    const result = resolveProtectedAnswerItem(item, piiQuestionIds, answerFieldsPii);

    expect(result.answer).toBe('홍길동');
    expect(result.piiProtected).toBe(false);
  });

  it('replaces the answer with the masked preview only when a ciphertext actually exists', () => {
    const item = { questionId: 'q-name', answer: '홍길동' };
    const answerFieldsPii = {
      maskedByQuestionId: { 'q-name': '홍*동' },
      fields: { values: { 'q-name': 'ciphertext' } },
    };

    const result = resolveProtectedAnswerItem(item, piiQuestionIds, answerFieldsPii);

    expect(result.answer).toBe('홍*동');
    expect(result.piiProtected).toBe(true);
  });

  it('handles null/undefined answer items safely', () => {
    expect(resolveProtectedAnswerItem(null, piiQuestionIds, { maskedByQuestionId: {}, fields: null })).toBeNull();
  });
});

describe('buildRespondentPiiFields', () => {
  const applicantIdentity = { name: '홍길동', phone: '010-1234-5678', birthDate: '1990-01-01' };

  it('stores plaintext applicant fields when encryption failed (piiProtected: false)', () => {
    const respondentPii = {
      nameMasked: '홍*동',
      phoneMasked: '010-****-5678',
      birthDateMasked: '1990-**-**',
      encrypted: null,
      piiProtected: false,
    };

    const fields = buildRespondentPiiFields(applicantIdentity, respondentPii);

    expect(fields.applicantName).toBe('홍길동');
    expect(fields.applicantPhone).toBe('010-1234-5678');
    expect(fields.applicantBirthDate).toBe('1990-01-01');
    expect(fields.respondentName).toBe('홍길동');
    expect(fields.respondentPhone).toBe('010-1234-5678');
    // 마스킹 미리보기 필드는 암호화 성공 여부와 무관하게 항상 채워진다(목록 표시용).
    expect(fields.applicantNameMasked).toBe('홍*동');
    expect(fields.applicantPii).toBeNull();
    expect(fields.piiProtected).toBe(false);
  });

  it('stores only masked preview (never plaintext) when encryption actually succeeded', () => {
    const respondentPii = {
      nameMasked: '홍*동',
      phoneMasked: '010-****-5678',
      birthDateMasked: '1990-**-**',
      encrypted: { name: 'ct-name', phone: 'ct-phone', birthDate: 'ct-birth', keyVersion: 'v1', encryptedAt: 'now' },
      piiProtected: true,
    };

    const fields = buildRespondentPiiFields(applicantIdentity, respondentPii);

    expect(fields.applicantName).toBeNull();
    expect(fields.applicantPhone).toBeNull();
    expect(fields.applicantBirthDate).toBeNull();
    expect(fields.respondentName).toBe('홍*동');
    expect(fields.respondentPhone).toBe('010-****-5678');
    expect(fields.applicantPii).toEqual(respondentPii.encrypted);
    expect(fields.piiProtected).toBe(true);
  });
});

describe('isOriginalPiiLost', () => {
  it('returns false for a true legacy (pre-2026-07-12) response — no *Masked fields at all', () => {
    expect(isOriginalPiiLost({ applicantName: '홍길동', applicantPhone: '010-1234-5678' })).toBe(false);
  });

  it('returns false once this fix is applied (piiProtected:false but applicantName is present)', () => {
    expect(
      isOriginalPiiLost({
        piiProtected: false,
        applicantPii: null,
        applicantNameMasked: '홍*동',
        applicantName: '홍길동',
      }),
    ).toBe(false);
  });

  it('returns false for a successfully KMS-encrypted response', () => {
    expect(
      isOriginalPiiLost({
        piiProtected: true,
        applicantPii: { name: 'ct' },
        applicantNameMasked: '홍*동',
        applicantName: null,
      }),
    ).toBe(false);
  });

  it('returns true for a response written during the broken window (2026-07-12 ~ this fix): piiProtected false, no ciphertext, applicantName never set', () => {
    expect(
      isOriginalPiiLost({
        piiProtected: false,
        applicantPii: null,
        applicantNameMasked: '홍*동',
        applicantPhoneMasked: '010-****-5678',
      }),
    ).toBe(true);
  });

  it('returns false for an empty/missing respondent', () => {
    expect(isOriginalPiiLost(undefined)).toBe(false);
    expect(isOriginalPiiLost(null)).toBe(false);
  });
});

describe('extractApplicationResponseSummary — original PII lost (broken-window responses)', () => {
  const questions = [
    { id: 'q-name', type: QUESTION_TYPES.SHORT_TEXT, title: '이름' },
    { id: 'q-phone', type: QUESTION_TYPES.PHONE, title: '연락처' },
  ];

  it('shows an explicit "확인 불가" marker instead of silently returning the already-masked answers[] text', () => {
    const lostResponse = {
      answers: [
        { questionId: 'q-name', answer: '홍*동' },
        { questionId: 'q-phone', answer: '010-****-5678' },
      ],
      respondent: {
        piiProtected: false,
        applicantPii: null,
        applicantNameMasked: '홍*동',
        applicantPhoneMasked: '010-****-5678',
      },
    };

    const summary = extractApplicationResponseSummary(questions, lostResponse);

    expect(summary.isOriginalLost).toBe(true);
    expect(summary.name).toBe('[원본 확인 불가]');
    expect(summary.phone).toBe('[원본 확인 불가]');
  });
});

describe('maskName/maskPhone — "[원본 확인 불가]" passthrough', () => {
  it('does not mangle the original-lost marker when a non-admin download re-applies masking', () => {
    expect(maskName('[원본 확인 불가]')).toBe('[원본 확인 불가]');
    expect(maskPhone('[원본 확인 불가]')).toBe('[원본 확인 불가]');
  });
});
