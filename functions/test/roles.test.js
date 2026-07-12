import { describe, it, expect } from 'vitest';
import { normalizeRole, isSuperAdminEmail, canRevealResponsePii, isResponseOwner, resolveCallerRole } from '../src/roles.js';

describe('normalizeRole', () => {
  it('treats protected super admin emails as super_admin regardless of stored role', () => {
    expect(normalizeRole('viewer', 'lth8210@yeongjung.or.kr')).toBe('super_admin');
  });

  it('maps legacy Korean role labels', () => {
    expect(normalizeRole('관리자', 'someone@yeongjung.or.kr')).toBe('admin');
    expect(normalizeRole('제작자', 'someone@yeongjung.or.kr')).toBe('creator');
    expect(normalizeRole('직원', 'someone@yeongjung.or.kr')).toBe('viewer');
  });

  it('falls back to creator for internal-domain emails with no role doc', () => {
    expect(normalizeRole(undefined, 'nobody@yeongjung.or.kr')).toBe('creator');
  });

  it('returns null for external emails with no recognizable role', () => {
    expect(normalizeRole(undefined, 'outsider@example.com')).toBeNull();
  });
});

describe('isSuperAdminEmail', () => {
  it('matches the protected list case-insensitively', () => {
    expect(isSuperAdminEmail('LTH8210@YEONGJUNG.OR.KR')).toBe(true);
    expect(isSuperAdminEmail('random@yeongjung.or.kr')).toBe(false);
  });
});

describe('isResponseOwner', () => {
  it('matches by uid', () => {
    expect(isResponseOwner({ surveyOwnerUid: 'u1' }, { uid: 'u1', email: '' })).toBe(true);
  });

  it('matches by email case-insensitively', () => {
    expect(
      isResponseOwner({ surveyCreatedByEmail: 'Owner@Yeongjung.or.kr' }, { uid: 'x', email: 'owner@yeongjung.or.kr' }),
    ).toBe(true);
  });

  it('returns false when neither uid nor email match', () => {
    expect(isResponseOwner({ surveyOwnerUid: 'other' }, { uid: 'u1', email: 'a@b.com' })).toBe(false);
  });
});

describe('canRevealResponsePii', () => {
  it('denies inactive callers regardless of role', () => {
    expect(canRevealResponsePii({ role: 'super_admin', status: 'inactive' }, {})).toBe(false);
  });

  it('allows admin and super_admin for any response', () => {
    expect(canRevealResponsePii({ role: 'admin', status: 'active' }, {})).toBe(true);
    expect(canRevealResponsePii({ role: 'super_admin', status: 'active' }, {})).toBe(true);
  });

  it('allows creator only when they own the response', () => {
    const caller = { role: 'creator', status: 'active', uid: 'u1', email: 'a@b.com' };
    expect(canRevealResponsePii(caller, { surveyOwnerUid: 'u1' })).toBe(true);
    expect(canRevealResponsePii(caller, { surveyOwnerUid: 'someone-else' })).toBe(false);
  });

  it('denies viewers', () => {
    expect(canRevealResponsePii({ role: 'viewer', status: 'active' }, {})).toBe(false);
  });
});

describe('resolveCallerRole', () => {
  function makeFakeDb(userData) {
    return {
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: userData !== null,
            data: () => userData ?? {},
          }),
        }),
      }),
    };
  }

  it('resolves super_admin from protected email even without a user doc', async () => {
    const db = makeFakeDb(null);
    const auth = { uid: 'u1', token: { email: 'yj100@yeongjung.or.kr' } };
    const caller = await resolveCallerRole(db, auth);
    expect(caller.role).toBe('super_admin');
    expect(caller.status).toBe('active');
  });

  it('resolves role/status from the users/{uid} document', async () => {
    const db = makeFakeDb({ role: 'admin', status: 'active', displayName: '관리자A' });
    const auth = { uid: 'u2', token: { email: 'admin@yeongjung.or.kr' } };
    const caller = await resolveCallerRole(db, auth);
    expect(caller.role).toBe('admin');
    expect(caller.status).toBe('active');
    expect(caller.displayName).toBe('관리자A');
  });
});
