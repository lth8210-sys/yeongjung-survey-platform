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

// 회귀 배경: buildSurveyAnalytics()의 분포(distribution) 버킷이 항상 score=index+1로
// 생성되어(1부터 시작) settings.min이 0인 척도(예: Q42/Q43 0~10점)에서 0점 응답이
// 분포표·전체평균·표준편차 계산에서 통째로 빠지는 버그가 있었다. 전체평균은
// scoredRows.distribution을 다시 펼쳐(flatMap) 계산하므로, 문항별 평균(row.values
// 기반, 0점 포함)과 전체평균이 서로 모순되는 값이 나왔다.
describe('buildSurveyAnalytics — 0점 포함 척도(min=0) 분포·평균 정확성', () => {
  const scaleSurvey = {
    id: 'survey-scale',
    questions: [
      {
        id: 'q42',
        type: QUESTION_TYPES.LINEAR_SCALE,
        title: 'Q42. 삶의 만족도',
        settings: { min: 0, max: 10 },
      },
    ],
  };

  it('0점 응답이 분포표에 정상적으로 집계된다', () => {
    const responses = [
      { id: 'r1', answers: [{ questionId: 'q42', answer: '0' }] },
      { id: 'r2', answers: [{ questionId: 'q42', answer: '5' }] },
      { id: 'r3', answers: [{ questionId: 'q42', answer: '10' }] },
    ];

    const analytics = buildSurveyAnalytics(scaleSurvey, responses);
    const row = analytics.scoredRows[0];

    expect(row.min).toBe(0);
    expect(row.max).toBe(10);
    expect(row.distribution).toHaveLength(11);
    expect(row.distribution[0]).toEqual({ score: 0, count: 1 });
    expect(row.distribution.find((d) => d.score === 5)?.count).toBe(1);
    expect(row.distribution.find((d) => d.score === 10)?.count).toBe(1);
  });

  it('0점 응답이 전체평균(totalAverage) 계산에 포함된다(분포 재구성 방식이므로 분포 누락 시 평균도 왜곡됨)', () => {
    const responses = [
      { id: 'r1', answers: [{ questionId: 'q42', answer: '0' }] },
      { id: 'r2', answers: [{ questionId: 'q42', answer: '10' }] },
    ];

    const analytics = buildSurveyAnalytics(scaleSurvey, responses);
    // (0 + 10) / 2 = 5. 수정 전 버그였다면 0점이 분포에서 빠져 평균이 10으로 왜곡됐다.
    expect(analytics.totalAverage).toBe(5);
  });

  it('문항별 평균(row.average, 0점 포함 원본 값 기반)과 전체평균이 일치한다(단일 문항 기준)', () => {
    const responses = [
      { id: 'r1', answers: [{ questionId: 'q42', answer: '0' }] },
      { id: 'r2', answers: [{ questionId: 'q42', answer: '4' }] },
    ];

    const analytics = buildSurveyAnalytics(scaleSurvey, responses);
    expect(analytics.scoredRows[0].average).toBe(analytics.totalAverage);
  });

  it('singleChoice 숫자형 옵션(1~5점, min=1 고정) 문항은 기존과 동일하게 1부터 분포가 생성된다', () => {
    const agreementSurvey = {
      id: 'survey-agreement',
      questions: [
        {
          id: 'q1',
          type: QUESTION_TYPES.SINGLE_CHOICE,
          title: 'Q1. 동의 정도',
          options: ['1. 전혀 그렇지 않다', '2.', '3.', '4.', '5. 매우 그렇다'],
          meta: { scaleMax: 5 },
        },
      ],
    };
    const responses = [{ id: 'r1', answers: [{ questionId: 'q1', answer: '1. 전혀 그렇지 않다' }] }];

    const analytics = buildSurveyAnalytics(agreementSurvey, responses);
    const row = analytics.scoredRows[0];

    expect(row.min).toBe(1);
    expect(row.max).toBe(5);
    expect(row.distribution).toHaveLength(5);
    expect(row.distribution[0].score).toBe(1);
  });
});
