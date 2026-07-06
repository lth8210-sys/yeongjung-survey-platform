import { describe, it, expect } from 'vitest';
import { shouldReleaseLock } from '../src/firebase/surveys.js';

// [KI-012 회귀 방지] 응답 삭제 시 중복신청/슬롯 lock을 함께 해제하는 로직의 안전장치.
// lock 문서 ID는 32비트 비암호화 해시(hashString)로 만들어지므로 충돌 가능성이
// 있다 — shouldReleaseLock은 lock에 기록된 responseId가 지금 삭제 중인 응답과
// 정확히 일치할 때만 삭제를 허용해, 해시 충돌로 다른 신청자의 lock을 잘못
// 해제하는 사고를 막는다.
describe('shouldReleaseLock — 응답 삭제 시 lock 정리 안전장치', () => {
  it('lock의 responseId가 삭제 대상 응답과 일치하면 해제 가능', () => {
    expect(shouldReleaseLock({ responseId: 'resp-1' }, 'resp-1')).toBe(true);
  });

  it('lock의 responseId가 다르면(해시 충돌 등) 해제하지 않는다', () => {
    expect(shouldReleaseLock({ responseId: 'resp-other' }, 'resp-1')).toBe(false);
  });

  it('lock 데이터가 없으면(문서 미존재) 해제하지 않는다', () => {
    expect(shouldReleaseLock(undefined, 'resp-1')).toBe(false);
    expect(shouldReleaseLock(null, 'resp-1')).toBe(false);
  });

  it('타입이 달라도(문자열 비교) 안전하게 비교한다', () => {
    expect(shouldReleaseLock({ responseId: 123 }, '123')).toBe(true);
  });
});
