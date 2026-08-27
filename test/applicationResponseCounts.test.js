import { describe, expect, it } from 'vitest';
import {
  FORM_TYPES,
  getApplicationResponseCounts,
  getResponseDeletionOutcome,
  getSurveyCountDisplay,
  RESPONSE_STATUSES,
} from '../src/firebase/surveys.js';

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

  it('cancelled 응답 삭제는 현재 신청을 유지하고 취소·전체 접수만 하나씩 줄인다', () => {
    const responses = [
      ...Array.from({ length: 8 }, () => ({ status: RESPONSE_STATUSES.SUBMITTED })),
      { status: RESPONSE_STATUSES.CANCELLED, deleted: true },
      { status: RESPONSE_STATUSES.CANCELLED },
    ];

    expect(getApplicationResponseCounts(responses)).toEqual({
      activeApplications: 8,
      cancelled: 1,
      totalSubmitted: 9,
    });
  });
});

describe('getSurveyCountDisplay — 설문 유형별 숫자 표현', () => {
  it('신청형은 취소 후 재신청의 1 → 0 → 1 정원 점유를 현재 신청/정원으로 표시한다', () => {
    const applicationSurvey = {
      formType: FORM_TYPES.GENERAL_APPLICATION,
      quotaEnabled: true,
      maxResponses: 1,
    };

    expect([1, 0, 1].map((responseCount) => getSurveyCountDisplay({ ...applicationSurvey, responseCount }))).toEqual([
      '현재 신청 1건 / 정원 1건',
      '현재 신청 0건 / 정원 1건',
      '현재 신청 1건 / 정원 1건',
    ]);
  });

  it('취소 이력이 있어도 persisted responseCount만 정원 표시의 현재 신청으로 사용한다', () => {
    const survey = {
      formType: FORM_TYPES.GENERAL_APPLICATION,
      quotaEnabled: true,
      maxResponses: 1,
      responseCount: 1,
    };
    const responseHistory = [
      { status: RESPONSE_STATUSES.SUBMITTED },
      { status: RESPONSE_STATUSES.CANCELLED },
    ];

    expect(getApplicationResponseCounts(responseHistory)).toEqual({
      activeApplications: 1,
      cancelled: 1,
      totalSubmitted: 2,
    });
    expect(getSurveyCountDisplay(survey)).toBe('현재 신청 1건 / 정원 1건');
  });

  it('일반 설문은 기존 응답/최대 표현을 유지한다', () => {
    expect(
      getSurveyCountDisplay({
        formType: FORM_TYPES.GENERAL_SURVEY,
        quotaEnabled: true,
        maxResponses: 20,
        responseCount: 7,
      }),
    ).toBe('응답 7건 / 최대 20건');
  });
});

describe('getResponseDeletionOutcome — 상태별 정원 반환 계약', () => {
  it('submitted 응답 삭제는 정원을 한 번 반환한다', () => {
    expect(getResponseDeletionOutcome({ status: RESPONSE_STATUSES.SUBMITTED })).toEqual({
      deleted: true,
      capacityReleased: true,
    });
  });

  it('cancelled 응답 삭제는 이력만 제거하고 정원을 다시 반환하지 않는다', () => {
    expect(getResponseDeletionOutcome({ status: RESPONSE_STATUSES.CANCELLED })).toEqual({
      deleted: true,
      capacityReleased: false,
    });
  });

  it('cancel → delete 전체 흐름에서 capacity 반환은 취소 시 한 번뿐이다', () => {
    const responseCountAfterCancel = 8;
    const deleteOutcome = getResponseDeletionOutcome({ status: RESPONSE_STATUSES.CANCELLED });
    const responseCountAfterDelete = deleteOutcome.capacityReleased
      ? responseCountAfterCancel - 1
      : responseCountAfterCancel;

    expect(responseCountAfterDelete).toBe(8);
  });

  it('이미 삭제된 응답은 counter·quota·lock·audit을 건드리지 않는 no-op이다', () => {
    expect(getResponseDeletionOutcome({ deleted: true, status: RESPONSE_STATUSES.SUBMITTED })).toEqual({
      deleted: false,
      capacityReleased: false,
    });
  });
});
