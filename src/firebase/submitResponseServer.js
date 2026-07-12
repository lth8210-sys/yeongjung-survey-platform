import { httpsCallable } from 'firebase/functions';
import { functionsClient, isFirebaseConfigured } from './config';
import { logger } from '../utils/logger';

/**
 * Structure A(서버 콜러블 전면 이전) 제출 경로.
 * submitSurveyResponse()(src/firebase/surveys.js)의 dispatcher가 VITE_USE_SERVER_RESPONSE_SUBMISSION=true일 때
 * 이 함수를 호출한다. 서버(submitProtectedSurveyResponse)가 quota/중복신청/슬롯락/idempotency/PII
 * 마스킹·암호화를 전부 재검증·재계산한다 — 이 함수는 필요한 원본 입력만 전달할 뿐, 마스킹값·암호문·
 * role 같은 신뢰가 필요한 값은 애초에 보내지 않는다(서버가 신뢰하지 않으므로 보내도 무시된다).
 *
 * @returns {Promise<string>} responseId — 기존 submitSurveyResponse()와 동일한 반환 타입을 유지해
 *   호출부(SurveyResponsePage.jsx)가 dispatcher 분기와 무관하게 동일하게 쓸 수 있게 한다.
 */
export async function submitSurveyResponseViaServer({
  surveyId,
  answers = [],
  respondent,
  responseMode,
  visibleQuestionIds,
  visibleSectionIds,
  skippedQuestionIds,
  clientSubmitId,
  quotaInput,
}) {
  if (!isFirebaseConfigured || !functionsClient) {
    throw new Error('Firebase Functions가 설정되지 않았습니다.');
  }

  const submit = httpsCallable(functionsClient, 'submitProtectedSurveyResponse');

  try {
    const result = await submit({
      surveyId,
      answers,
      respondent: { submittedFrom: respondent?.submittedFrom ?? 'web' },
      responseMode,
      visibleQuestionIds,
      visibleSectionIds,
      skippedQuestionIds,
      clientSubmitId,
      quotaInput,
    });

    return result?.data?.responseId;
  } catch (error) {
    // Firebase JS SDK의 httpsCallable 에러 code는 "functions/failed-precondition"처럼 접두사가
    // 붙는다 — 기존 클라이언트 트랜잭션 경로(bare "failed-precondition")를 기대하는
    // getSubmitErrorMessage()(SurveyResponsePage.jsx) 등 기존 에러 매칭 코드를 바꾸지 않기 위해
    // 여기서 접두사를 벗겨 동일한 형태로 정규화한다.
    const normalizedCode = String(error?.code ?? '').replace(/^functions\//, '') || 'internal';
    logger.error('[submitResponseServer] submitProtectedSurveyResponse failed', { code: normalizedCode });

    const normalizedError = new Error(error?.message || '응답 저장에 실패했습니다.');
    normalizedError.code = normalizedCode;
    throw normalizedError;
  }
}
