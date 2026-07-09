import { describe, it, expect } from 'vitest';
import { buildVisibleQuestionFlow, getResponseMode } from '../src/utils/responseFlow.js';
import { QUESTION_TYPES, BRANCH_ACTIONS, CONDITION_OPERATORS } from '../src/firebase/surveyConstants.js';

// 이 테스트 스위트는 ai/RESPONSE_FLOW.md에 문서화된 "응답 흐름의 핵심 원칙"과
// ai/AI_HANDOFF.md의 "가장 중요한 이슈"(객관식 이후 주관식/장문형 문항 누락 및 자동 제출)를
// 회귀 방지 대상으로 고정한다. 픽스처는 실제 운영 중인
// "2026 영중 지역주민 욕구조사" 템플릿(src/data/formTemplates.js)의 구조
// (다중 섹션 + 분기 + 말미 주관식/장문형 문항)를 단순화해 재현한다.

function buildNeedsSurveyLikeFixture() {
  return {
    sections: [
      { id: 'basic_info', title: '1. 기본정보' },
      { id: 'lifecycle_needs', title: '2. 생애주기별 욕구' },
    ],
    questions: [
      {
        id: 'q1-area',
        sectionId: 'basic_info',
        type: QUESTION_TYPES.SINGLE_CHOICE,
        title: '거주지역',
        options: ['영등포동', '당산동'],
        required: true,
      },
      {
        id: 'q2-duration',
        sectionId: 'basic_info',
        type: QUESTION_TYPES.SHORT_TEXT,
        title: '거주기간',
        required: true,
      },
      {
        id: 'q3-household',
        sectionId: 'basic_info',
        type: QUESTION_TYPES.SINGLE_CHOICE,
        title: '가구형태',
        options: ['1인가구', '다인가구'],
        required: true,
        branching: {
          enabled: true,
          rules: [
            {
              whenOption: '1인가구',
              action: BRANCH_ACTIONS.GO_TO,
              targetQuestionId: 'q5-lonely-care',
            },
          ],
          fallbackAction: BRANCH_ACTIONS.NEXT,
        },
      },
      // 다인가구를 선택했을 때만 자연 진행으로 방문하는 질문 (1인가구는 건너뜀)
      {
        id: 'q4-family-count',
        sectionId: 'basic_info',
        type: QUESTION_TYPES.NUMBER,
        title: '동거인 수',
        required: true,
      },
      // 분기 목표 지점 — 1인가구/다인가구 모두 이후 합류
      {
        id: 'q5-lonely-care',
        sectionId: 'basic_info',
        type: QUESTION_TYPES.SINGLE_CHOICE,
        title: '돌봄 필요 여부',
        options: ['예', '아니오'],
        required: true,
      },
      // 핵심 회귀 대상: 선택형 문항들 뒤에 오는 주관식/장문형 문항
      {
        id: 'q6-opinion',
        sectionId: 'lifecycle_needs',
        type: QUESTION_TYPES.LONG_TEXT,
        title: '복지관에 바라는 점을 자유롭게 적어주세요.',
        required: false,
      },
      {
        id: 'q7-contact',
        sectionId: 'lifecycle_needs',
        type: QUESTION_TYPES.PHONE,
        title: '결과 안내를 받을 연락처(선택)',
        required: false,
      },
    ],
  };
}

describe('buildVisibleQuestionFlow — 욕구조사형 다중 섹션/분기 흐름', () => {
  it('분기 미해당 질문에 응답이 없어도 모든 질문이 흐름에 노출된다 (필수 여부 무관 표시 원칙)', () => {
    const survey = buildNeedsSurveyLikeFixture();
    const flow = buildVisibleQuestionFlow({ survey, answers: {} });

    // q1(지역), q2(거주기간)은 분기 대상이 아니므로 무응답이어도 반드시 노출되어야 한다.
    expect(flow.visibleQuestionIds).toContain('q1-area');
    expect(flow.visibleQuestionIds).toContain('q2-duration');
  });

  it('분기 질문이 아직 미응답이면 그 지점에서 흐름 계산이 멈춘다 (다음 목적지 불명확)', () => {
    const survey = buildNeedsSurveyLikeFixture();
    const flow = buildVisibleQuestionFlow({ survey, answers: { 'q1-area': '영등포동', 'q2-duration': '5년' } });

    expect(flow.visibleQuestionIds).toEqual(['q1-area', 'q2-duration', 'q3-household']);
    expect(flow.visibleQuestionIds).not.toContain('q6-opinion');
  });

  it('"1인가구" 분기 선택 시 q4를 건너뛰고 분기 목적지(q5)로 합류하며, 이후 장문형/전화번호 문항이 누락되지 않는다', () => {
    const survey = buildNeedsSurveyLikeFixture();
    const flow = buildVisibleQuestionFlow({
      survey,
      answers: {
        'q1-area': '영등포동',
        'q2-duration': '5년',
        'q3-household': '1인가구',
        'q5-lonely-care': '예',
      },
    });

    expect(flow.visibleQuestionIds).toEqual([
      'q1-area',
      'q2-duration',
      'q3-household',
      'q5-lonely-care',
      'q6-opinion',
      'q7-contact',
    ]);
    expect(flow.visibleQuestionIds).not.toContain('q4-family-count');
    expect(flow.skippedQuestionIds).toContain('q4-family-count');
    // 장문형/전화번호(비필수) 문항이 절대 누락되면 안 된다 — AI_HANDOFF.md 핵심 이슈 회귀 방지
    expect(flow.visibleQuestionIds).toContain('q6-opinion');
    expect(flow.visibleQuestionIds).toContain('q7-contact');
  });

  it('"다인가구" 분기 선택 시 q4를 거쳐 자연 진행하며, 이후 장문형/전화번호 문항이 누락되지 않는다', () => {
    const survey = buildNeedsSurveyLikeFixture();
    const flow = buildVisibleQuestionFlow({
      survey,
      answers: {
        'q1-area': '영등포동',
        'q2-duration': '5년',
        'q3-household': '다인가구',
        'q4-family-count': '3',
        'q5-lonely-care': '아니오',
      },
    });

    expect(flow.visibleQuestionIds).toEqual([
      'q1-area',
      'q2-duration',
      'q3-household',
      'q4-family-count',
      'q5-lonely-care',
      'q6-opinion',
      'q7-contact',
    ]);
  });

  it('groupedSections는 마지막 섹션(장문형 포함)이 실제로 방문됐을 때 온전히 포함되어야 한다 (마지막 페이지 오판단 방지)', () => {
    const survey = buildNeedsSurveyLikeFixture();
    const flow = buildVisibleQuestionFlow({
      survey,
      answers: {
        'q1-area': '영등포동',
        'q2-duration': '5년',
        'q3-household': '다인가구',
        'q4-family-count': '3',
        'q5-lonely-care': '아니오',
      },
    });

    const lastSection = flow.groupedSections[flow.groupedSections.length - 1];
    expect(lastSection.id).toBe('lifecycle_needs');
    // 선택형이 아닌 마지막 문항들이 실제로 렌더 대상 섹션에 포함되는지 확인
    const lastSectionQuestionIds = lastSection.questions.map((question) => question.id);
    expect(lastSectionQuestionIds).toEqual(['q6-opinion', 'q7-contact']);
  });

  it('알 수 없는 legacy type 별칭(textarea/paragraph 등)도 숨겨지지 않고 longText로 정규화되어 흐름에 남는다', () => {
    const survey = buildNeedsSurveyLikeFixture();
    survey.questions.push({
      id: 'q8-legacy-textarea',
      sectionId: 'lifecycle_needs',
      type: 'textarea', // legacy alias
      title: '기타 의견(legacy)',
      required: false,
    });

    const flow = buildVisibleQuestionFlow({
      survey,
      answers: {
        'q1-area': '영등포동',
        'q2-duration': '5년',
        'q3-household': '다인가구',
        'q4-family-count': '3',
        'q5-lonely-care': '아니오',
      },
    });

    expect(flow.visibleQuestionIds).toContain('q8-legacy-textarea');
  });

  it('getResponseMode: 섹션이 2개 이상이면 paged, 1개 이하면 single', () => {
    expect(getResponseMode({ sections: [{ id: 'a' }, { id: 'b' }] })).toBe('paged');
    expect(getResponseMode({ sections: [{ id: 'a' }] })).toBe('single');
    expect(getResponseMode({ sections: [] })).toBe('single');
  });

  it('섹션 종료(pageEndAction=end) 시 termination이 설정되고 이후 질문은 노출되지 않는다', () => {
    const survey = {
      sections: [
        { id: 's1', title: '섹션1', pageEndAction: 'end', terminationMessage: '대상이 아니므로 종료합니다.' },
        { id: 's2', title: '섹션2' },
      ],
      questions: [
        { id: 'q1', sectionId: 's1', type: QUESTION_TYPES.SHORT_TEXT, required: false },
        { id: 'q2', sectionId: 's2', type: QUESTION_TYPES.SHORT_TEXT, required: false },
      ],
    };

    const flow = buildVisibleQuestionFlow({ survey, answers: {} });

    expect(flow.termination).toBeTruthy();
    expect(flow.visibleQuestionIds).not.toContain('q2');
  });
});

// "2026 영중 지역주민 욕구조사" Q45(세대원, 해당 모두 선택) → Q46-1~6(세대별 욕구) 문항
// 조건부 표시 회귀 방지 테스트. Q46-x는 question.visibilityConditions에 Q45 응답이
// 해당 세대를 포함(INCLUDES)하는지 조건이 걸려 있으며, 같은 섹션 안에서 동적으로
// 보이거나 숨겨져야 한다(섹션/페이지 이동 없이).
function buildGenerationNeedsFixture() {
  const generationVisibility = (label) => ({
    visibilityConditions: [{ questionId: 'q45', operator: CONDITION_OPERATORS.INCLUDES, value: label }],
  });

  return {
    sections: [{ id: 'lifecycle_needs', title: '생애주기별 욕구' }],
    questions: [
      {
        id: 'q45',
        sectionId: 'lifecycle_needs',
        type: QUESTION_TYPES.MULTIPLE_CHOICE,
        title: '세대원',
        options: ['영유아', '아동', '청소년', '청년', '중장년', '노년'],
        required: true,
      },
      { id: 'q46-1', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.MULTIPLE_CHOICE, title: '[영유아] 욕구', options: ['a', 'b'], required: false, ...generationVisibility('영유아') },
      { id: 'q46-2', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.MULTIPLE_CHOICE, title: '[아동] 욕구', options: ['a', 'b'], required: false, ...generationVisibility('아동') },
      { id: 'q46-3', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.MULTIPLE_CHOICE, title: '[청소년] 욕구', options: ['a', 'b'], required: false, ...generationVisibility('청소년') },
      { id: 'q46-4', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.MULTIPLE_CHOICE, title: '[청년] 욕구', options: ['a', 'b'], required: false, ...generationVisibility('청년') },
      { id: 'q46-5', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.MULTIPLE_CHOICE, title: '[중장년] 욕구', options: ['a', 'b'], required: false, ...generationVisibility('중장년') },
      { id: 'q46-6-birthyear', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.NUMBER, title: '[노년] 출생연도', required: false, ...generationVisibility('노년') },
      { id: 'q46-6', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.MULTIPLE_CHOICE, title: '[노년] 욕구', options: ['a', 'b'], required: false, ...generationVisibility('노년') },
      { id: 'q47-next', sectionId: 'lifecycle_needs', type: QUESTION_TYPES.SHORT_TEXT, title: '다음 문항', required: false },
    ],
  };
}

describe('buildVisibleQuestionFlow — Q45 세대원 선택에 따른 Q46 조건부 표시', () => {
  it('영유아만 선택하면 영유아 욕구 문항만 노출된다', () => {
    const survey = buildGenerationNeedsFixture();
    const flow = buildVisibleQuestionFlow({ survey, answers: { q45: ['영유아'] } });

    expect(flow.visibleQuestionIds).toContain('q46-1');
    expect(flow.visibleQuestionIds).not.toContain('q46-2');
    expect(flow.visibleQuestionIds).not.toContain('q46-3');
    expect(flow.visibleQuestionIds).not.toContain('q46-4');
    expect(flow.visibleQuestionIds).not.toContain('q46-5');
    expect(flow.visibleQuestionIds).not.toContain('q46-6-birthyear');
    expect(flow.visibleQuestionIds).not.toContain('q46-6');
    // 조건부로 숨겨진 문항은 진행률/제출 대상에서 제외되도록 skippedQuestionIds에 포함된다.
    expect(flow.skippedQuestionIds).toContain('q46-2');
    // 이어지는 문항은 정상적으로 계속 노출된다 (흐름이 끊기지 않음).
    expect(flow.visibleQuestionIds).toContain('q47-next');
  });

  it('아동과 청소년을 함께 선택하면 두 문항만 노출된다', () => {
    const survey = buildGenerationNeedsFixture();
    const flow = buildVisibleQuestionFlow({ survey, answers: { q45: ['아동', '청소년'] } });

    expect(flow.visibleQuestionIds).toContain('q46-2');
    expect(flow.visibleQuestionIds).toContain('q46-3');
    expect(flow.visibleQuestionIds).not.toContain('q46-1');
    expect(flow.visibleQuestionIds).not.toContain('q46-4');
    expect(flow.visibleQuestionIds).not.toContain('q46-5');
    expect(flow.visibleQuestionIds).not.toContain('q46-6');
  });

  it('청년만 선택하면 청년 욕구 문항만 노출된다', () => {
    const survey = buildGenerationNeedsFixture();
    const flow = buildVisibleQuestionFlow({ survey, answers: { q45: ['청년'] } });

    expect(flow.visibleQuestionIds).toEqual(['q45', 'q46-4', 'q47-next']);
  });

  it('노년을 선택하면 출생연도 문항과 노년 욕구 문항이 함께 노출된다', () => {
    const survey = buildGenerationNeedsFixture();
    const flow = buildVisibleQuestionFlow({ survey, answers: { q45: ['노년'] } });

    expect(flow.visibleQuestionIds).toContain('q46-6-birthyear');
    expect(flow.visibleQuestionIds).toContain('q46-6');
    expect(flow.visibleQuestionIds).not.toContain('q46-1');
  });

  it('아무 세대도 선택하지 않으면 세대별 욕구 문항이 하나도 노출되지 않는다', () => {
    const survey = buildGenerationNeedsFixture();
    const flow = buildVisibleQuestionFlow({ survey, answers: { q45: [] } });

    expect(flow.visibleQuestionIds).toEqual(['q45', 'q47-next']);
    expect(flow.skippedQuestionIds).toEqual(
      expect.arrayContaining(['q46-1', 'q46-2', 'q46-3', 'q46-4', 'q46-5', 'q46-6-birthyear', 'q46-6']),
    );
  });
});
