import { describe, it, expect } from 'vitest';
import { FORM_TEMPLATES } from '../src/data/formTemplates.js';
import { buildVisibleQuestionFlow } from '../src/utils/responseFlow.js';
import { QUESTION_TYPES } from '../src/firebase/surveyConstants.js';

// "2026 영중 지역주민 욕구조사" 템플릿(src/data/formTemplates.js)이 최신 설문지(DOCX)와
// 실제로 일치하는지, Q45→Q46 조건부 표시가 실제 문항 id/보기 문자열로도 정상 동작하는지
// 검증하는 통합 테스트. 합성 픽스처가 아닌 실제 템플릿 데이터를 그대로 사용한다.
const template = FORM_TEMPLATES.find((t) => t.id === 'yeongjung_community_needs_2026_v1');
const surveyFixture = { questions: template.questions, sections: template.sections };

function findQuestion(id) {
  return template.questions.find((q) => q.id === id);
}

describe('2026 영중 지역주민 욕구조사 템플릿 — 최신 설문지 반영 검증', () => {
  it('Q1은 주소 자유 입력 문항이며 지역 선택형이 아니다', () => {
    const q1 = findQuestion('needs-q01');
    expect(q1.type).toBe(QUESTION_TYPES.SHORT_TEXT);
    expect(q1.meta?.addressField).toBe(true);
    expect(q1.options ?? []).toEqual([]);
  });

  it('Q45는 세대원 다중선택이며 6개 세대 보기를 모두 포함한다', () => {
    const q45 = findQuestion('needs-q45');
    expect(q45.type).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    expect(q45.options).toEqual(['영유아(0~만 5세)', '아동(만 6세~만 11세)', '청소년', '청년', '중장년', '노년']);
  });

  it('Q46-1~6과 노년 출생연도 문항은 모두 Q45 기반 visibilityConditions을 갖는다', () => {
    ['needs-q46-1', 'needs-q46-2', 'needs-q46-3', 'needs-q46-4', 'needs-q46-5', 'needs-q46-6', 'needs-q46-6-birthyear'].forEach(
      (id) => {
        const question = findQuestion(id);
        expect(question, `${id} 문항이 존재해야 한다`).toBeTruthy();
        expect(question.visibilityConditions?.[0]?.questionId).toBe('needs-q45');
      },
    );
  });

  it('중장년(46-5)과 노년(46-6) 보기에는 "경제적 지원"이 포함된다', () => {
    expect(findQuestion('needs-q46-5').options).toContain('경제적 지원');
    expect(findQuestion('needs-q46-6').options).toContain('경제적 지원');
  });

  it('구 Q47(지원 필요 이유)은 삭제되었고, Q47은 선호 요일/시간대 문항이다', () => {
    expect(findQuestion('needs-q47').title).toContain('선호하는 요일과 시간대');
  });

  it('Q48(동네 불편)은 "재개발·상권변화" 보기를 포함하지 않는다', () => {
    expect(findQuestion('needs-q48').options).not.toContain('재개발·상권변화로 인한 불편');
  });

  it('마지막 개방형 문항은 Q49~Q52 4개이며 Q53은 존재하지 않는다', () => {
    ['needs-q49', 'needs-q50', 'needs-q51', 'needs-q52'].forEach((id) => {
      expect(findQuestion(id).type).toBe(QUESTION_TYPES.LONG_TEXT);
    });
    expect(findQuestion('needs-q53')).toBeUndefined();
  });

  it('영유아만 선택 시 실제 흐름에서 needs-q46-1만 노출되고 나머지 세대 문항은 숨겨진다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예', 'needs-q45': ['영유아(0~만 5세)'] },
    });

    expect(flow.visibleQuestionIds).toContain('needs-q46-1');
    ['needs-q46-2', 'needs-q46-3', 'needs-q46-4', 'needs-q46-5', 'needs-q46-6', 'needs-q46-6-birthyear'].forEach((id) => {
      expect(flow.visibleQuestionIds).not.toContain(id);
    });
  });

  it('노년 선택 시 출생연도와 노년 욕구 문항이 함께 노출된다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예', 'needs-q45': ['노년'] },
    });

    expect(flow.visibleQuestionIds).toContain('needs-q46-6-birthyear');
    expect(flow.visibleQuestionIds).toContain('needs-q46-6');
  });

  it('세대원을 아무것도 선택하지 않으면 Q46 계열 문항이 하나도 노출되지 않는다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예', 'needs-q45': [] },
    });

    const q46Ids = template.questions
      .map((q) => q.id)
      .filter((id) => id.startsWith('needs-q46'));
    q46Ids.forEach((id) => {
      expect(flow.visibleQuestionIds).not.toContain(id);
    });
  });

  it('quotaConfig는 age-only 구조이며 region 필드를 갖지 않는다', () => {
    expect(template.quotaConfig.regions).toBeUndefined();
    expect(template.quotaConfig.matrix).toBeUndefined();
    expect(template.quotaConfig.targets).toBeTruthy();
    expect(template.quotaConfig.ageGroups.length).toBe(4);
  });
});
