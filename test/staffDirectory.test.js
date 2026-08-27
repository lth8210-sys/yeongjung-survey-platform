import { describe, expect, it } from 'vitest';
import { buildStaffDirectoryProjection, normalizeStaffDirectoryItem, sortStaffDirectory } from '../src/firebase/staffDirectory.js';

describe('staff directory projection', () => {
  it('keeps only the minimum safe fields', () => expect(buildStaffDirectoryProjection({ uid: 'u1', displayName: ' 홍길동 ', status: 'active', email: 'hidden@example.com', department: 'hidden' })).toEqual({ uid: 'u1', displayName: '홍길동', active: true }));
  it('uses safe fallbacks and inactive conversion', () => expect(buildStaffDirectoryProjection({ uid: 'u1', status: 'blocked' })).toEqual({ uid: 'u1', displayName: '이름 없음', active: false }));
  it('sorts valid entries and ignores malformed entries', () => expect(sortStaffDirectory([{ uid: 'b', displayName: '나', status: 'active' }, { uid: '', displayName: '무효' }, { uid: 'a', displayName: '가', status: 'active' }]).map((item) => item.uid)).toEqual(['a', 'b']));
  it('returns null for malformed directory records', () => expect(normalizeStaffDirectoryItem({ displayName: '이름' })).toBeNull());
});
