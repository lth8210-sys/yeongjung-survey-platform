import { describe, expect, it } from 'vitest';
import { diffViewerGrantUids, normalizeViewerGrantUids, searchStaffDirectory } from '../src/firebase/viewerGrants.js';

describe('viewer grants', () => {
  it('rejects duplicate, owner, blank and over-limit grant inputs instead of silently normalizing them', () => {
    expect(normalizeViewerGrantUids(['a', 'a'], 'owner')).toBeNull();
    expect(normalizeViewerGrantUids(['owner'], 'owner')).toBeNull();
    expect(normalizeViewerGrantUids([''], 'owner')).toBeNull();
    expect(normalizeViewerGrantUids(Array.from({ length: 21 }, (_, index) => `u${index}`), 'owner')).toBeNull();
  });
  it('calculates only added and removed grants', () => {
    expect(diffViewerGrantUids(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });
  it('searches active minimal directory projections by display name only', () => {
    expect(searchStaffDirectory([{ uid: 'a', displayName: '가나다', active: true }, { uid: 'b', displayName: '라마', active: false }], '가')).toEqual([{ uid: 'a', displayName: '가나다', active: true }]);
  });
});
