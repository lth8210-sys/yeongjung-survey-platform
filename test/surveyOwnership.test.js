import { describe, it, expect } from 'vitest';
import { isSurveyOwner, canReadManagedSurvey, canEditSurvey, USER_ROLES } from '../src/firebase/users.js';

// "제작자가 자기 설문을 못 보는" 재발 버그(KI-001) 회귀 방지 테스트.
// surveys 문서의 소유자 필드는 역사적으로 6종(ownerUid/createdByUid/ownerId/userId/
// ownerEmail/createdByEmail/createdBy.uid/createdBy.email)이 혼재해왔다(03_INFORMATION_ARCHITECTURE_REVIEW.md 참조).
// 어떤 필드 조합으로 저장되어 있든 본인 설문으로 인식되어야 한다.
describe('isSurveyOwner — 소유자 필드 6종 호환', () => {
  const user = { uid: 'user-1', email: 'creator@yeongjung.or.kr' };

  it.each([
    ['ownerUid', { ownerUid: 'user-1' }],
    ['createdByUid', { createdByUid: 'user-1' }],
    ['ownerId', { ownerId: 'user-1' }],
    ['userId', { userId: 'user-1' }],
    ['ownerEmail', { ownerEmail: 'creator@yeongjung.or.kr' }],
    ['createdByEmail', { createdByEmail: 'creator@yeongjung.or.kr' }],
    ['createdBy.uid', { createdBy: { uid: 'user-1' } }],
    ['createdBy.email', { createdBy: { email: 'creator@yeongjung.or.kr' } }],
  ])('%s 필드만 있어도 소유자로 인식된다', (_label, surveyFields) => {
    expect(isSurveyOwner(surveyFields, user)).toBe(true);
  });

  it('이메일 대소문자가 달라도 소유자로 인식된다', () => {
    expect(isSurveyOwner({ ownerEmail: 'CREATOR@YEONGJUNG.OR.KR' }, user)).toBe(true);
  });

  it('타인 소유 설문은 소유자로 인식되지 않는다', () => {
    expect(isSurveyOwner({ ownerUid: 'someone-else', ownerEmail: 'other@yeongjung.or.kr' }, user)).toBe(false);
  });

  it('survey 또는 user가 없으면 false', () => {
    expect(isSurveyOwner(null, user)).toBe(false);
    expect(isSurveyOwner({ ownerUid: 'user-1' }, null)).toBe(false);
  });
});

describe('canReadManagedSurvey / canEditSurvey — creator 권한 경계', () => {
  const user = { uid: 'user-1', email: 'creator@yeongjung.or.kr' };
  const ownSurvey = { ownerUid: 'user-1', visibility: 'private' };
  const otherPrivateSurvey = { ownerUid: 'someone-else', visibility: 'private' };
  const orgSurvey = { ownerUid: 'someone-else', visibility: 'organization' };

  it('creator는 본인 소유 private 설문을 읽고 수정할 수 있다', () => {
    expect(canReadManagedSurvey(USER_ROLES.CREATOR, ownSurvey, user)).toBe(true);
    expect(canEditSurvey(USER_ROLES.CREATOR, ownSurvey, user)).toBe(true);
  });

  it('creator는 타인 소유 private 설문을 읽거나 수정할 수 없다', () => {
    expect(canReadManagedSurvey(USER_ROLES.CREATOR, otherPrivateSurvey, user)).toBe(false);
    expect(canEditSurvey(USER_ROLES.CREATOR, otherPrivateSurvey, user)).toBe(false);
  });

  it('creator는 조직공개 설문을 읽을 수 있지만 수정은 할 수 없다', () => {
    expect(canReadManagedSurvey(USER_ROLES.CREATOR, orgSurvey, user)).toBe(true);
    expect(canEditSurvey(USER_ROLES.CREATOR, orgSurvey, user)).toBe(false);
  });

  it('admin 이상은 소유 여부와 무관하게 읽고 수정할 수 있다', () => {
    expect(canReadManagedSurvey(USER_ROLES.ADMIN, otherPrivateSurvey, user)).toBe(true);
    expect(canEditSurvey(USER_ROLES.ADMIN, otherPrivateSurvey, user)).toBe(true);
  });

  it('viewer는 조직공개 설문을 읽을 수 있지만 private 타인 설문은 읽을 수 없다', () => {
    expect(canReadManagedSurvey(USER_ROLES.VIEWER, orgSurvey, user)).toBe(true);
    expect(canReadManagedSurvey(USER_ROLES.VIEWER, otherPrivateSurvey, user)).toBe(false);
  });
});
