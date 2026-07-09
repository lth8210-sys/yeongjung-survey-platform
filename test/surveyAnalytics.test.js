import { describe, it, expect } from 'vitest';
import { buildSurveyAnalytics } from '../src/utils/surveyAnalytics.js';
import { QUESTION_TYPES } from '../src/firebase/surveyConstants.js';

// 결과보고서 생성 오류(Release Candidate 안정화 작업, Phase 5) 회귀 방지 테스트.
// SurveyReportPage.jsx는 buildSurveyAnalytics()를 useMemo에서 호출하며, 이 함수가
// 예외를 던지면 페이지 전체가 흰 화면으로 죽는다(렌더 중 예외는 기존 try/catch로
// 잡히지 않음). 여기서는 실제로 발생할 수 있는 비정상/경계 데이터(숨겨진 문항으로
// 인해 일부 응답에 없는 답변, 구버전 응답 필드, 문항 id 불일치, null/malformed
// 응답)를 넣어도 예외 없이 안전한 결과를 반환하는지 검증한다.
describe('buildSurveyAnalytics — 결과보고 생성 안정성', () => {
  const survey = {
    id: 'survey-1',
    questions: [
      { id: 'q1', type: QUESTION_TYPES.SINGLE_CHOICE, options: ['1. 매우 그렇다', '2. 그렇다'] },
      { id: 'q2', type: QUESTION_TYPES.LONG_TEXT },
      { id: 'q3', type: QUESTION_TYPES.SHORT_TEXT, title: '살고있는 곳(거주/생활 지역)' },
    ],
  };

  it('빈 응답 배열이어도 예외 없이 기본값을 반환한다', () => {
    expect(() => buildSurveyAnalytics(survey, [])).not.toThrow();
    const analytics = buildSurveyAnalytics(survey, []);
    expect(analytics.totalAverage).toBe(null);
    expect(analytics.scoredRows).toEqual([]);
    expect(analytics.textResponses).toEqual([]);
  });

  it('조건부로 숨겨진 문항이라 answers에 아예 없는 응답이 섞여 있어도 예외가 없다', () => {
    const responses = [
      { id: 'r1', answers: [{ questionId: 'q1', answer: '1. 매우 그렇다' }] },
      // q1 답변이 없는 응답(조건부 미노출로 저장되지 않은 경우)
      { id: 'r2', answers: [{ questionId: 'q2', answer: '좋았습니다' }] },
    ];

    expect(() => buildSurveyAnalytics(survey, responses)).not.toThrow();
  });

  it('설문 개편으로 문항 id가 바뀌어 응답의 questionId와 매칭되지 않아도 예외가 없다', () => {
    const responses = [
      { id: 'r1', answers: [{ questionId: 'needs-q47-old-removed', answer: '어떤 값' }] },
    ];

    expect(() => buildSurveyAnalytics(survey, responses)).not.toThrow();
  });

  it('answers가 배열이 아니거나 없는 malformed/구버전 응답이 섞여 있어도 예외가 없다', () => {
    const responses = [
      { id: 'r1' }, // answers 필드 자체가 없음
      { id: 'r2', answers: null },
      { id: 'r3', answers: [{ questionId: 'q1', answer: null }] },
      { id: 'r4', answers: [{ questionId: 'q2', answer: undefined }] },
    ];

    expect(() => buildSurveyAnalytics(survey, responses)).not.toThrow();
  });

  it('survey.questions가 없거나 빈 배열이어도 예외가 없다', () => {
    expect(() => buildSurveyAnalytics({ id: 's' }, [{ id: 'r1', answers: [] }])).not.toThrow();
    expect(() => buildSurveyAnalytics({ id: 's', questions: [] }, [])).not.toThrow();
  });

  it('quota 필드가 구버전(region) 또는 신버전(연령 전용) 상관없이 통계 계산에 영향을 주지 않는다', () => {
    const responses = [
      {
        id: 'r1',
        answers: [{ questionId: 'q1', answer: '1. 매우 그렇다' }],
        quota: { area: '영등포본동', regionId: 'region_3', regionLabel: '3권역', ageGroupId: 'age_20_39' },
      },
      {
        id: 'r2',
        answers: [{ questionId: 'q1', answer: '2. 그렇다' }],
        quota: { birthYear: 1990, age: 36, ageGroupId: 'age_20_39', ageGroupLabel: '20~39세', isOverQuota: false },
      },
    ];

    expect(() => buildSurveyAnalytics(survey, responses)).not.toThrow();
    const analytics = buildSurveyAnalytics(survey, responses);
    expect(analytics.scoredRows.length).toBeGreaterThan(0);
  });
});
