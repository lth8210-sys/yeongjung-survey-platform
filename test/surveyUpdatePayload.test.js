import { describe, it, expect } from 'vitest';
import { resolveQuestionPayload } from '../src/firebase/surveys.js';

// [Critical 회귀 방지] 2026-07-01 커밋(b5c175e)에서 questions/draftQuestions 분리 로직이
// 도입된 뒤, SurveyBuilderPage.jsx가 publishDraft를 넘기지 않아 기존 설문을 편집·저장해도
// 응답자가 보는 questions 필드가 전혀 갱신되지 않는(=편집 내용이 사라진 것처럼 보이는)
// 회귀가 있었다. 빌더는 이제 항상 publishDraft:true로 저장하므로, 그 경로가 절대
// questions를 누락하지 않는지 고정한다.
describe('resolveQuestionPayload — 설문 저장 시 공개 문항(questions) 반영 보장', () => {
  const normalizedQuestions = [{ id: 'q1', title: '수정된 질문' }];
  const normalizedSections = [{ id: 's1', title: '섹션1' }];

  it('publishDraft:true (빌더의 실제 저장 경로)는 기존 설문이어도 항상 questions를 갱신한다', () => {
    const currentData = {
      questions: [{ id: 'q1', title: '이전 질문' }],
      sections: [{ id: 's1', title: '이전 섹션' }],
    };

    const payload = resolveQuestionPayload({
      currentData,
      normalizedQuestions,
      normalizedSections,
      publishDraft: true,
    });

    expect(payload.questions).toEqual(normalizedQuestions);
    expect(payload.draftQuestions).toEqual(normalizedQuestions);
    expect(payload.sections).toEqual(normalizedSections);
  });

  it('publishDraft:true는 questions가 비어있던 신규 설문에도 questions를 채운다', () => {
    const payload = resolveQuestionPayload({
      currentData: {},
      normalizedQuestions,
      normalizedSections,
      publishDraft: true,
    });

    expect(payload.questions).toEqual(normalizedQuestions);
  });

  it('publishDraft 생략(false 기본값) + 기존 questions 존재 시에는 draftQuestions만 갱신한다 (향후 초안 UX 전용 경로, 현재 빌더는 사용하지 않음)', () => {
    const currentData = {
      questions: [{ id: 'q1', title: '이전 질문' }],
      sections: [{ id: 's1', title: '이전 섹션' }],
    };

    const payload = resolveQuestionPayload({
      currentData,
      normalizedQuestions,
      normalizedSections,
    });

    expect(payload.draftQuestions).toEqual(normalizedQuestions);
    expect(payload.questions).toBeUndefined();
    expect(payload.sections).toBeUndefined();
  });

  it('publishDraft:false여도 questions가 아직 없던 설문(신규)이면 questions를 채운다', () => {
    const payload = resolveQuestionPayload({
      currentData: {},
      normalizedQuestions,
      normalizedSections,
      publishDraft: false,
    });

    expect(payload.questions).toEqual(normalizedQuestions);
    expect(payload.sections).toEqual(normalizedSections);
  });
});
