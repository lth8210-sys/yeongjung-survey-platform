import { describe, it, expect } from 'vitest';
import { FORM_TEMPLATES } from '../src/data/formTemplates.js';
import { normalizeQuestions, createQuestionId, createSectionId } from '../src/firebase/surveyNormalize.js';
import { remapStructureIds } from '../src/firebase/surveyTemplates.js';
import { buildVisibleQuestionFlow } from '../src/utils/responseFlow.js';

// 회귀 배경: SurveyBuilderPage.jsx의 applyTemplate()과 duplicateSection()은 템플릿/섹션을
// 복제할 때 문항 ID를 전부 재발급하면서 branching.targetQuestionId만 새 ID로 remap하고,
// visibilityConditions.questionId와 meta.conditionalConsentField는 remap하지 않았다. 그
// 결과 "2026 영중 지역주민 욕구조사" 템플릿을 Builder에서 적용해 게시하면 Q45→Q46 조건부
// 표시와 "연락처 입력 시 개인정보 동의 필수" 정책이 실제 응답 화면에서 항상 무력화되었다
// (연락처를 입력해도 동의 체크 없이 제출이 성공 — PII가 동의 없이 저장되는 컴플라이언스
// 문제). 수정 후에는 instantiateSurveyTemplate()에서 이미 쓰이던 remapStructureIds()
// (필드 이름과 무관하게 idMap에 매칭되는 모든 문자열 값을 치환하는 범용 함수)를
// applyTemplate()/duplicateSection() 양쪽에서 재사용한다. 이 테스트는 두 함수를 직접
// 렌더링하지 않고, 두 함수가 실제로 수행하는 절차(normalizeQuestions → id map 생성 →
// remapStructureIds)를 그대로 재현해 검증한다.

const template = FORM_TEMPLATES.find((t) => t.id === 'yeongjung_community_needs_2026_v1');

function applyTemplateLikeBuilder(sourceTemplate) {
  const normalizedTemplateQuestions = normalizeQuestions(sourceTemplate.questions ?? []);
  const duplicatedQuestionIds = normalizedTemplateQuestions.reduce((result, question) => {
    result.set(question.id, createQuestionId());
    return result;
  }, new Map());
  const withNewIds = normalizedTemplateQuestions.map((question) => ({
    ...question,
    id: duplicatedQuestionIds.get(question.id) ?? createQuestionId(),
  }));
  const remappedQuestions = remapStructureIds(withNewIds, duplicatedQuestionIds);
  const remappedTemplateMetadata = remapStructureIds(
    sourceTemplate.templateMetadata ?? {},
    duplicatedQuestionIds,
  );

  return { duplicatedQuestionIds, remappedQuestions, remappedTemplateMetadata };
}

function findRemapped(questions, originalId, originalQuestions) {
  const originalQuestion = originalQuestions.find((q) => q.id === originalId);
  const originalIndex = originalQuestions.indexOf(originalQuestion);
  return questions[originalIndex];
}

describe('applyTemplate() ID remap — visibilityConditions (Q45→Q46)', () => {
  const { duplicatedQuestionIds, remappedQuestions } = applyTemplateLikeBuilder(template);
  const newQ45Id = duplicatedQuestionIds.get('needs-q45');

  it('Q45의 새 ID가 재발급된다(원본 ID와 달라야 한다)', () => {
    expect(newQ45Id).toBeTruthy();
    expect(newQ45Id).not.toBe('needs-q45');
  });

  it('Q46-1~Q46-6, Q46-6-birthyear의 visibilityConditions.questionId가 모두 새 Q45 ID를 가리킨다(구식 리터럴 "needs-q45" 아님)', () => {
    const q46Ids = [
      'needs-q46-1',
      'needs-q46-2',
      'needs-q46-3',
      'needs-q46-4',
      'needs-q46-5',
      'needs-q46-6',
    ];

    q46Ids.forEach((originalId) => {
      const remapped = findRemapped(remappedQuestions, originalId, template.questions);
      expect(remapped.visibilityConditions.length).toBeGreaterThan(0);
      remapped.visibilityConditions.forEach((condition) => {
        expect(condition.questionId).toBe(newQ45Id);
        expect(condition.questionId).not.toBe('needs-q45');
      });
    });
  });

  it('remap된 질문으로 buildVisibleQuestionFlow를 실행하면 Q45(영유아) 선택 시 새 Q46-1 ID가 실제로 노출된다', () => {
    const newQ46_1Id = duplicatedQuestionIds.get('needs-q46-1');
    const newQ46_2Id = duplicatedQuestionIds.get('needs-q46-2');
    const surveyFixture = { questions: remappedQuestions, sections: template.sections };

    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: {
        [duplicatedQuestionIds.get('needs-q28')]: '예',
        [duplicatedQuestionIds.get('needs-q34')]: '예',
        [newQ45Id]: ['영유아(0~만 5세)'],
      },
    });

    expect(flow.visibleQuestionIds).toContain(newQ46_1Id);
    expect(flow.visibleQuestionIds).not.toContain(newQ46_2Id);
  });
});

describe('applyTemplate() ID remap — meta.conditionalConsentField (조건부 개인정보 동의)', () => {
  const { duplicatedQuestionIds, remappedQuestions } = applyTemplateLikeBuilder(template);

  it('동의 문항의 meta.conditionalConsentField가 연락처 문항의 새 ID를 가리킨다(구식 리터럴 아님)', () => {
    const newContactId = duplicatedQuestionIds.get('needs-consent-contact');
    const remappedConsent = findRemapped(remappedQuestions, 'needs-consent-checkbox', template.questions);

    expect(newContactId).toBeTruthy();
    expect(remappedConsent.meta.conditionalConsentField).toBe(newContactId);
    expect(remappedConsent.meta.conditionalConsentField).not.toBe('needs-consent-contact');
  });

  it('remap된 문항 목록에서 conditionalConsentField로 실제 연락처 문항을 찾을 수 있다(SurveyResponsePage.jsx validateAnswers와 동일한 조회 방식)', () => {
    const remappedConsent = findRemapped(remappedQuestions, 'needs-consent-checkbox', template.questions);
    const triggerId = remappedConsent.meta.conditionalConsentField;
    const triggerIndex = remappedQuestions.findIndex((item) => item.id === triggerId);

    // remap 누락 시 triggerIndex === -1이 되어 조건부 동의 검증이 항상 통과(버그)로
    // 흘러가던 것이 이번 수정의 핵심 회귀 지점이다.
    expect(triggerIndex).toBeGreaterThanOrEqual(0);
    expect(remappedQuestions[triggerIndex].title).toContain('경품 제공 안내');
  });
});

describe('applyTemplate() ID remap — branching (기존에도 동작했으나 회귀 방지)', () => {
  const { duplicatedQuestionIds, remappedQuestions } = applyTemplateLikeBuilder(template);

  it('Q28의 branching.rules[].targetQuestionId가 Q29/Q30의 새 ID를 가리킨다', () => {
    const remappedQ28 = findRemapped(remappedQuestions, 'needs-q28', template.questions);
    const newQ29Id = duplicatedQuestionIds.get('needs-q29');
    const newQ30Id = duplicatedQuestionIds.get('needs-q30');

    const yesRule = remappedQ28.branching.rules.find((rule) => rule.whenOption === '예');
    const noRule = remappedQ28.branching.rules.find((rule) => rule.whenOption === '아니오');

    expect(yesRule.targetQuestionId).toBe(newQ29Id);
    expect(noRule.targetQuestionId).toBe(newQ30Id);
  });

  it('Q35의 fallbackTargetQuestionId가 Q41의 새 ID를 가리킨다', () => {
    const remappedQ35 = findRemapped(remappedQuestions, 'needs-q35', template.questions);
    const newQ41Id = duplicatedQuestionIds.get('needs-q41');

    expect(remappedQ35.branching.fallbackTargetQuestionId).toBe(newQ41Id);
  });
});

describe('applyTemplate() ID remap — templateMetadata.quotaBirthYearQuestionId', () => {
  it('quotaBirthYearQuestionId가 Q4의 새 ID로 치환된다', () => {
    const { duplicatedQuestionIds, remappedTemplateMetadata } = applyTemplateLikeBuilder(template);
    const newQ4Id = duplicatedQuestionIds.get('needs-q04');

    expect(remappedTemplateMetadata.quotaBirthYearQuestionId).toBe(newQ4Id);
    expect(remappedTemplateMetadata.quotaBirthYearQuestionId).not.toBe('needs-q04');
  });
});

describe('applyTemplate() ID remap — 무관한 데이터는 변경되지 않는다', () => {
  const { remappedQuestions } = applyTemplateLikeBuilder(template);

  it('옵션 문자열("예"/"아니오" 등)은 idMap과 무관하므로 그대로 유지된다', () => {
    const remappedQ28 = findRemapped(remappedQuestions, 'needs-q28', template.questions);
    expect(remappedQ28.options).toEqual(['예', '아니오']);
  });

  it('제목·설명 텍스트는 remap 이후에도 그대로 유지된다', () => {
    const remappedQ1 = findRemapped(remappedQuestions, 'needs-q01', template.questions);
    expect(remappedQ1.title).toBe('Q1. 현재 거주하는 곳의 주소는 무엇입니까?');
    expect(remappedQ1.description).toContain('양산로 232');
  });

  it('quotaField처럼 ID가 아닌 라벨 값("birthYear"/"none")은 idMap에 없으므로 그대로 유지된다', () => {
    const remappedQ4 = findRemapped(remappedQuestions, 'needs-q04', template.questions);
    const remappedSeniorBirthYear = findRemapped(
      remappedQuestions,
      'needs-q46-6-birthyear',
      template.questions,
    );

    expect(remappedQ4.meta.quotaField).toBe('birthYear');
    expect(remappedSeniorBirthYear.meta.quotaField).toBe('none');
  });
});

describe('remapStructureIds() — 범용 동작 (섹션 복제 duplicateSection() 시나리오 포함)', () => {
  it('배열/객체를 재귀적으로 순회하며 idMap에 매칭되는 문자열 값만 치환한다', () => {
    const idMap = new Map([
      ['old-question-1', 'new-question-1'],
      ['old-section-1', 'new-section-1'],
    ]);

    const input = {
      id: 'old-section-1',
      title: '섹션 제목',
      pageEndTargetSectionId: 'old-section-1',
      visibilityConditions: [{ id: 'cond-1', questionId: 'old-question-1', operator: 'equals', value: '예' }],
      terminationConditions: [
        { id: 'cond-2', questionId: 'old-question-1', operator: 'equals', value: '아니오' },
      ],
      questions: [
        {
          id: 'old-question-1',
          title: '문항 제목',
          options: ['예', '아니오'],
          meta: { conditionalConsentField: 'old-question-1' },
          branching: {
            rules: [{ whenOption: '예', targetQuestionId: 'old-question-1' }],
            fallbackTargetQuestionId: 'old-question-1',
          },
        },
      ],
    };

    const result = remapStructureIds(input, idMap);

    expect(result.id).toBe('new-section-1');
    expect(result.pageEndTargetSectionId).toBe('new-section-1');
    expect(result.visibilityConditions[0].questionId).toBe('new-question-1');
    expect(result.terminationConditions[0].questionId).toBe('new-question-1');
    expect(result.questions[0].meta.conditionalConsentField).toBe('new-question-1');
    expect(result.questions[0].branching.rules[0].targetQuestionId).toBe('new-question-1');
    expect(result.questions[0].branching.fallbackTargetQuestionId).toBe('new-question-1');
    // idMap과 무관한 문자열(제목, 옵션 값)은 그대로 유지되어야 한다
    expect(result.title).toBe('섹션 제목');
    expect(result.questions[0].options).toEqual(['예', '아니오']);
  });

  it('idMap에 없는 문자열, 숫자, boolean, null은 그대로 통과한다', () => {
    const idMap = new Map([['a', 'b']]);
    const input = { count: 3, active: true, empty: null, label: 'unmatched' };

    const result = remapStructureIds(input, idMap);

    expect(result).toEqual(input);
  });

  it('createSectionId()로 만든 새 섹션 ID는 idMap의 key가 아니므로 재치환되지 않는다(이중 remap 방지 확인)', () => {
    const oldSectionId = 'section-old';
    const newSectionId = createSectionId();
    const idMap = new Map([[oldSectionId, newSectionId]]);

    const result = remapStructureIds({ id: oldSectionId, ref: newSectionId }, idMap);

    expect(result.id).toBe(newSectionId);
    // newSectionId 자체는 idMap의 key가 아니므로(값으로만 존재) 그대로 유지되어야 한다
    expect(result.ref).toBe(newSectionId);
  });
});
