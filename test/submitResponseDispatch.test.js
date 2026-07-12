import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Structure A 전환 회귀 테스트: VITE_USE_SERVER_RESPONSE_SUBMISSION 플래그에 따라
// submitSurveyResponse()가 서버 콜러블 경로로만 위임하고, 레거시 클라이언트 트랜잭션 코드는
// 아예 실행되지 않아야 한다(레거시 경로가 실행되면 Firestore client SDK를 건드리므로 아래
// mock되지 않은 './config'를 통해 실패하거나 예외를 던진다 — 그 자체가 회귀 신호가 된다).

const submitSurveyResponseViaServerMock = vi.fn(async () => 'server-response-id');

vi.mock('../src/firebase/submitResponseServer.js', () => ({
  submitSurveyResponseViaServer: (...args) => submitSurveyResponseViaServerMock(...args),
}));

describe('submitSurveyResponse dispatcher', () => {
  beforeEach(() => {
    submitSurveyResponseViaServerMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('delegates to the server callable when the feature flag is "true"', async () => {
    vi.stubEnv('VITE_USE_SERVER_RESPONSE_SUBMISSION', 'true');
    const { submitSurveyResponse } = await import('../src/firebase/surveys.js');

    const payload = { surveyId: 's1', clientSubmitId: 'c1', answers: [] };
    const responseId = await submitSurveyResponse(payload);

    expect(responseId).toBe('server-response-id');
    expect(submitSurveyResponseViaServerMock).toHaveBeenCalledWith(payload);
  });

  it('does NOT call the server callable when the feature flag is unset (legacy path)', async () => {
    vi.stubEnv('VITE_USE_SERVER_RESPONSE_SUBMISSION', undefined);
    const { submitSurveyResponse } = await import('../src/firebase/surveys.js');

    // Firebase가 설정되지 않은 테스트 환경에서는 레거시 경로가 ensureFirestoreReady()에서
    // 즉시 예외를 던진다 — 여기서는 "서버 콜러블이 호출되지 않았다"만 확인한다(레거시 경로 자체의
    // 동작은 이 리포지토리에 기존에도 별도 테스트가 없다 — Firestore 트랜잭션 의존성 때문).
    await expect(submitSurveyResponse({ surveyId: 's1' })).rejects.toThrow();
    expect(submitSurveyResponseViaServerMock).not.toHaveBeenCalled();
  });
});
