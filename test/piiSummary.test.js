import { describe, it, expect } from 'vitest';
import { extractApplicationResponseSummary } from '../src/firebase/surveys.js';
import { QUESTION_TYPES } from '../src/firebase/surveyConstants.js';
import { maskBirthDate, maskName, maskPhone } from '../src/utils/privacy.js';

// 2026-07 PII 보호 하드닝 회귀 테스트: extractApplicationResponseSummary가
// (1) 레거시(비보호) 응답에서는 종전과 동일하게 answers에서 이름/전화를 추출하고,
// (2) 보호된(신규) 응답에서는 answers 대신 마스킹 미리보기를 기본값으로 쓰며,
// (3) revealedPii가 주어지면 그 값을 최우선한다는 것을 고정한다.

const questions = [
  { id: 'q-name', type: QUESTION_TYPES.SHORT_TEXT, title: '이름' },
  { id: 'q-phone', type: QUESTION_TYPES.PHONE, title: '연락처' },
];

function makeAnswers(name, phone) {
  return [
    { questionId: 'q-name', answer: name },
    { questionId: 'q-phone', answer: phone },
  ];
}

describe('extractApplicationResponseSummary — legacy (unprotected) responses', () => {
  it('extracts name/phone straight from answers, unchanged from prior behavior', () => {
    const response = { answers: makeAnswers('홍길동', '010-1234-5678') };
    const summary = extractApplicationResponseSummary(questions, response);
    expect(summary.name).toBe('홍길동');
    expect(summary.phone).toBe('010-1234-5678');
    expect(summary.isPiiProtected).toBe(false);
  });
});

describe('extractApplicationResponseSummary — protected (new-scheme) responses', () => {
  const protectedResponse = {
    answers: makeAnswers('홍길동', '010-1234-5678'),
    respondent: {
      piiProtected: true,
      applicantNameMasked: '홍*동',
      applicantPhoneMasked: '010-****-5678',
      applicantPii: { name: 'ciphertext', phone: 'ciphertext', birthDate: null },
    },
  };

  it('defaults to the masked preview instead of re-deriving plaintext from answers', () => {
    const summary = extractApplicationResponseSummary(questions, protectedResponse);
    expect(summary.name).toBe('홍*동');
    expect(summary.phone).toBe('010-****-5678');
    expect(summary.isPiiProtected).toBe(true);
    // 마스킹 미리보기가 실제 정규 마스킹 함수 출력과 일치하는지도 확인(가짜 값이 아님).
    expect(summary.name).toBe(maskName('홍길동'));
    expect(summary.phone).toBe(maskPhone('010-1234-5678'));
  });

  it('prefers explicitly revealed PII over the masked preview', () => {
    const summary = extractApplicationResponseSummary(questions, protectedResponse, {
      revealedPii: { name: '홍길동', phone: '010-1234-5678', birthDate: '1990-05-01' },
    });
    expect(summary.name).toBe('홍길동');
    expect(summary.phone).toBe('010-1234-5678');
  });

  it('does not crash when the protected respondent has no masked fields yet (encryption failed at submit time)', () => {
    const partiallyProtected = {
      answers: makeAnswers('홍길동', '010-1234-5678'),
      respondent: { piiProtected: false },
    };
    const summary = extractApplicationResponseSummary(questions, partiallyProtected);
    expect(summary.isPiiProtected).toBe(false);
    expect(summary.name).toBe('홍길동');
  });
});

describe('maskBirthDate (new masking helper)', () => {
  it('keeps only the birth year', () => {
    expect(maskBirthDate('1990-05-01')).toBe('1990-**-**');
  });

  it('returns **** when the value has no leading 4-digit year', () => {
    expect(maskBirthDate('모름')).toBe('****');
  });
});
