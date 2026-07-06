import { describe, it, expect } from 'vitest';
import { getMaxSelections } from '../src/firebase/surveyNormalize.js';

// 다중선택 문항의 "N개까지 선택" 제한이 실제로 강제되지 않던 버그의 회귀 방지 테스트.
// 실제 "2026 영중 지역주민 욕구조사" 템플릿(src/data/formTemplates.js)의 문항들은
// 제목에 "2개까지 선택"이라고 적혀 있지만 명시적 데이터 필드가 없었고, 기존 정규식은
// "최대 N개" 형태만 인식해 "N개까지 선택"과 매칭되지 않아 실제로는 제한이
// 전혀 걸리지 않았다.
describe('getMaxSelections — 명시적 설정값 우선', () => {
  it('question.validation.maxSelections이 최우선으로 사용된다 (빌더 UI 저장 경로)', () => {
    expect(getMaxSelections({ validation: { maxSelections: 2 }, title: '아무 제목' })).toBe(2);
  });

  it('question.maxSelections(top-level)도 인식한다', () => {
    expect(getMaxSelections({ maxSelections: 3 })).toBe(3);
  });

  it('question.settings.maxSelections도 인식한다', () => {
    expect(getMaxSelections({ settings: { maxSelections: 1 } })).toBe(1);
  });

  it('명시적 값이 텍스트 추정보다 항상 우선한다', () => {
    expect(
      getMaxSelections({
        validation: { maxSelections: 5 },
        title: '2개까지 선택',
      }),
    ).toBe(5);
  });
});

describe('getMaxSelections — 텍스트 휴리스틱 (하위호환)', () => {
  it('"2개까지 선택" 문구를 인식한다 (실제 욕구조사 템플릿 문구)', () => {
    expect(
      getMaxSelections({ title: '복지관이 가장 중요하게 해야 할 역할은 무엇입니까? 2개까지 선택' }),
    ).toBe(2);
  });

  it('"최대 2개" 문구도 여전히 인식한다 (기존 동작 유지)', () => {
    expect(getMaxSelections({ title: '최대 2개까지 응답 가능합니다' })).toBe(2);
  });

  it('"3개까지 고르기" / "선정" 같은 변형 표현도 인식한다', () => {
    expect(getMaxSelections({ title: '가장 필요한 것 3개까지 고르세요' })).toBe(3);
    expect(getMaxSelections({ description: '2개까지 선정해주세요' })).toBe(2);
  });

  it('제한 문구가 전혀 없으면 null을 반환한다 (제한 없음)', () => {
    expect(getMaxSelections({ title: '좋아하는 색은 무엇입니까?' })).toBe(null);
  });

  it('옵션 텍스트에서도 탐지한다', () => {
    expect(getMaxSelections({ title: '질문', options: ['1개까지 선택 가능'] })).toBe(1);
  });
});

describe('getMaxSelections — 안전성', () => {
  it('question이 없거나 빈 객체여도 예외 없이 null을 반환한다', () => {
    expect(getMaxSelections()).toBe(null);
    expect(getMaxSelections({})).toBe(null);
  });

  it('0 이하 값은 무시하고 텍스트 추정으로 폴백한다', () => {
    expect(getMaxSelections({ validation: { maxSelections: 0 }, title: '2개까지 선택' })).toBe(2);
    expect(getMaxSelections({ validation: { maxSelections: -1 } })).toBe(null);
  });
});
