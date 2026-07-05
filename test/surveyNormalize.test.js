import { describe, it, expect } from 'vitest';
import {
  normalizeQuestionType,
  isNonResponseQuestionType,
  isAnswerEmpty,
} from '../src/firebase/surveyNormalize.js';
import { QUESTION_TYPES } from '../src/firebase/surveyConstants.js';

// ai/RESPONSE_FLOW.md에 명시된 legacy alias 목록의 회귀 방지 테스트.
// 새 alias를 추가할 때 이 테스트가 실패하면 문서와 코드가 어긋난 것이다.
describe('normalizeQuestionType — legacy/템플릿 alias 정규화', () => {
  it.each([
    ['short_text', QUESTION_TYPES.SHORT_TEXT],
    ['short', QUESTION_TYPES.SHORT_TEXT],
    ['text', QUESTION_TYPES.SHORT_TEXT],
    ['input', QUESTION_TYPES.SHORT_TEXT],
    ['subjective_short', QUESTION_TYPES.SHORT_TEXT],
    ['long_text', QUESTION_TYPES.LONG_TEXT],
    ['textarea', QUESTION_TYPES.LONG_TEXT],
    ['paragraph', QUESTION_TYPES.LONG_TEXT],
    ['subjective', QUESTION_TYPES.LONG_TEXT],
    ['single_choice', QUESTION_TYPES.SINGLE_CHOICE],
    ['radio', QUESTION_TYPES.SINGLE_CHOICE],
    ['multiple_choice', QUESTION_TYPES.MULTIPLE_CHOICE],
    ['checkbox', QUESTION_TYPES.MULTIPLE_CHOICE],
    ['application_slot_choice', QUESTION_TYPES.APPLICATION_SLOT_CHOICE],
    ['slot', QUESTION_TYPES.APPLICATION_SLOT_CHOICE],
    ['consent_checkbox', QUESTION_TYPES.CONSENT_CHECKBOX],
    ['consent', QUESTION_TYPES.CONSENT_CHECKBOX],
  ])('alias "%s" -> "%s"', (alias, expected) => {
    expect(normalizeQuestionType(alias)).toBe(expected);
  });

  it('알 수 없는 타입은 shortText로 fallback되며 절대 사라지지 않는다', () => {
    expect(normalizeQuestionType('완전히_모르는_타입')).toBe(QUESTION_TYPES.SHORT_TEXT);
    expect(normalizeQuestionType(undefined)).toBe(QUESTION_TYPES.SHORT_TEXT);
    expect(normalizeQuestionType(null)).toBe(QUESTION_TYPES.SHORT_TEXT);
  });

  it('표준 타입은 그대로 유지된다', () => {
    Object.values(QUESTION_TYPES).forEach((type) => {
      expect(normalizeQuestionType(type)).toBe(type);
    });
  });
});

describe('isNonResponseQuestionType', () => {
  it('설명 블록/섹션 제목은 응답 대상이 아니다', () => {
    expect(isNonResponseQuestionType(QUESTION_TYPES.DESCRIPTION_BLOCK)).toBe(true);
    expect(isNonResponseQuestionType(QUESTION_TYPES.SECTION_TITLE)).toBe(true);
  });

  it('그 외 모든 응답형 문항 타입은 응답 대상이다', () => {
    expect(isNonResponseQuestionType(QUESTION_TYPES.SHORT_TEXT)).toBe(false);
    expect(isNonResponseQuestionType(QUESTION_TYPES.LONG_TEXT)).toBe(false);
    expect(isNonResponseQuestionType(QUESTION_TYPES.SINGLE_CHOICE)).toBe(false);
  });
});

describe('isAnswerEmpty — 필수/선택 주관식 제출 가능 여부', () => {
  it('필수 주관식이 비어있으면 empty로 판정되어 제출을 막아야 한다', () => {
    const question = { type: QUESTION_TYPES.SHORT_TEXT, required: true };
    expect(isAnswerEmpty(question, '')).toBe(true);
    expect(isAnswerEmpty(question, '   ')).toBe(true);
    expect(isAnswerEmpty(question, '답변')).toBe(false);
  });

  it('선택(비필수) 주관식은 비어 있어도 제출 가능해야 한다', () => {
    const question = { type: QUESTION_TYPES.SHORT_TEXT, required: false };
    expect(isAnswerEmpty(question, '')).toBe(false);
  });

  it('필수 다중선택은 배열이 비어있으면 empty', () => {
    const question = { type: QUESTION_TYPES.MULTIPLE_CHOICE, required: true };
    expect(isAnswerEmpty(question, [])).toBe(true);
    expect(isAnswerEmpty(question, ['a'])).toBe(false);
    expect(isAnswerEmpty(question, 'not-an-array')).toBe(true);
  });

  it('필수 개인정보 동의는 true가 아니면 empty', () => {
    const question = { type: QUESTION_TYPES.CONSENT_CHECKBOX, required: true };
    expect(isAnswerEmpty(question, false)).toBe(true);
    expect(isAnswerEmpty(question, true)).toBe(false);
  });

  it('설명 블록/섹션 제목은 required 여부와 무관하게 항상 empty가 아니다 (제출 차단 대상 아님)', () => {
    expect(isAnswerEmpty({ type: QUESTION_TYPES.DESCRIPTION_BLOCK, required: true }, '')).toBe(false);
    expect(isAnswerEmpty({ type: QUESTION_TYPES.SECTION_TITLE, required: true }, '')).toBe(false);
  });
});
