import { describe, it, expect } from 'vitest';
import { identifyAnswerPiiQuestionIds } from '../src/firebase/surveys.js';
import { QUESTION_TYPES } from '../src/firebase/surveyConstants.js';

// 2026-07 PII 보호 하드닝 Phase 2 회귀 테스트.
// 핵심 불변 조건: identifyAnswerPiiQuestionIds는 "자유서술형 신원 식별 문항"만 골라야 한다 —
// 단일/다중선택형 인구통계 문항(연령대·거주 지역 등)을 잘못 포함하면 surveyAnalytics.js/
// statisticsExcel.js의 통계 집계가 저장 시점 마스킹으로 조용히 깨진다(사용자 확인 하에 제외 결정됨).
describe('identifyAnswerPiiQuestionIds', () => {
  it('flags EMAIL/PHONE questions regardless of title', () => {
    const ids = identifyAnswerPiiQuestionIds([
      { id: 'q-email', type: QUESTION_TYPES.EMAIL, title: '연락 가능한 주소' },
      { id: 'q-phone', type: QUESTION_TYPES.PHONE, title: '연락처' },
    ]);
    expect(ids.has('q-email')).toBe(true);
    expect(ids.has('q-phone')).toBe(true);
  });

  it('flags free-text questions whose title matches a PII keyword', () => {
    const ids = identifyAnswerPiiQuestionIds([
      { id: 'q-name', type: QUESTION_TYPES.SHORT_TEXT, title: '이름' },
      { id: 'q-birth', type: QUESTION_TYPES.DATE, title: '생년월일' },
      { id: 'q-addr', type: QUESTION_TYPES.LONG_TEXT, title: '상세 주소' },
    ]);
    expect(ids.has('q-name')).toBe(true);
    expect(ids.has('q-birth')).toBe(true);
    expect(ids.has('q-addr')).toBe(true);
  });

  it('does NOT flag single/multiple-choice demographic questions even if the title matches a keyword', () => {
    const ids = identifyAnswerPiiQuestionIds([
      { id: 'q-agegroup', type: QUESTION_TYPES.SINGLE_CHOICE, title: '연령대', options: ['20대', '30대'] },
      { id: 'q-region', type: QUESTION_TYPES.DROPDOWN, title: '거주 지역', options: ['서울', '경기'] },
      { id: 'q-guardian', type: QUESTION_TYPES.MULTIPLE_CHOICE, title: '보호자 동반 여부', options: ['예', '아니오'] },
    ]);
    expect(ids.has('q-agegroup')).toBe(false);
    expect(ids.has('q-region')).toBe(false);
    expect(ids.has('q-guardian')).toBe(false);
  });

  it('does not flag a free-text question with no PII keyword in its title', () => {
    const ids = identifyAnswerPiiQuestionIds([
      { id: 'q-opinion', type: QUESTION_TYPES.LONG_TEXT, title: '이번 행사에 대한 의견' },
      { id: 'q-date', type: QUESTION_TYPES.DATE, title: '희망 참여 일자' },
    ]);
    expect(ids.has('q-opinion')).toBe(false);
    expect(ids.has('q-date')).toBe(false);
  });

  it('returns an empty set for no/empty questions', () => {
    expect(identifyAnswerPiiQuestionIds([]).size).toBe(0);
    expect(identifyAnswerPiiQuestionIds(undefined).size).toBe(0);
  });
});
