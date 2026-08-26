import { describe, expect, it } from 'vitest';
import { getApplicationResponseCounts, RESPONSE_STATUSES } from '../src/firebase/surveys.js';

describe('getApplicationResponseCounts — 신청 현황 read-only 집계', () => {
  it('취소가 없으면 현재 신청과 전체 접수가 같다', () => {
    expect(getApplicationResponseCounts(Array.from({ length: 10 }, () => ({ status: 'submitted' })))).toEqual({
      activeApplications: 10,
      cancelled: 0,
      totalSubmitted: 10,
    });
  });

  it('취소 상태는 현재 신청에서만 제외하고 전체 접수에는 남긴다', () => {
    const responses = [
      ...Array.from({ length: 7 }, () => ({ status: RESPONSE_STATUSES.SUBMITTED })),
      ...Array.from({ length: 3 }, () => ({ status: RESPONSE_STATUSES.CANCELLED })),
    ];

    expect(getApplicationResponseCounts(responses)).toEqual({
      activeApplications: 7,
      cancelled: 3,
      totalSubmitted: 10,
    });
  });

  it('soft deleted 응답은 모든 표시 집계에서 제외한다', () => {
    const responses = [
      ...Array.from({ length: 7 }, () => ({ status: RESPONSE_STATUSES.SUBMITTED })),
      ...Array.from({ length: 2 }, () => ({ status: RESPONSE_STATUSES.CANCELLED })),
      { status: RESPONSE_STATUSES.SUBMITTED, deleted: true },
    ];

    expect(getApplicationResponseCounts(responses)).toEqual({
      activeApplications: 7,
      cancelled: 2,
      totalSubmitted: 9,
    });
  });
});
