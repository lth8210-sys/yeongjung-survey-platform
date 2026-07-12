/**
 * PII 보호 게이트 — 신규 응답 암호화 + 권한 있는 원문 복호화.
 *
 * 이 파일은 onCall 배선만 담당한다. 실제 로직은 src/handlers.js에 있다(테스트 가능하도록 분리).
 *
 * 1. encryptRespondentPii — 응답 제출 직전, 이름/전화/생년월일을 KMS로 암호화해 반환한다.
 *    비로그인 방문자도 호출할 수 있다(설문 응답 자체가 비로그인 제출을 전제로 하므로).
 * 2. encryptAnswerFields — 응답 제출 직전, answers[] 중 자유서술형 신원 식별 문항 값을 KMS로
 *    암호화해 반환한다. encryptRespondentPii와 동일하게 비로그인 방문자도 호출할 수 있다.
 * 3. revealResponsePii — 저장된 암호문(식별 요약 + 문항 답변)을 복호화해 반환한다.
 *    로그인 + 권한 검증 + 감사로그 기록이 필수다.
 * 4. submitProtectedSurveyResponse — 익명 설문 응답 생성 전체(Structure A). 기존
 *    encryptRespondentPii/encryptAnswerFields는 "암호화만" 해주고 실제 Firestore 쓰기는
 *    여전히 클라이언트가 수행하는 구조(Structure B)였다 — 이 콜러블은 그 쓰기 자체를 서버로
 *    옮긴다. src/survey/submission.js가 quota/중복신청/슬롯락/idempotency 판정 로직을 담당한다
 *    (src/firebase/surveys.js submitSurveyResponse()의 서버 사본 — SYNC REQUIRED, 각 파일
 *    상단 주석 참조). 클라이언트의 기존 경로(submitSurveyResponse, Structure B)는 단계적 전환을
 *    위해 그대로 남아 있다 — src/firebase/surveys.js의 VITE_USE_SERVER_RESPONSE_SUBMISSION
 *    feature flag가 꺼져 있으면 여전히 그 경로를 쓴다.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  handleEncryptRespondentPii,
  handleEncryptAnswerFields,
  handleRevealResponsePii,
} from './src/handlers.js';
import { handleSubmitProtectedSurveyResponse } from './src/submitResponse.js';

initializeApp();

// 공식 문서 기준 2nd-gen 파라미터 API(functions.config() 대체):
// https://firebase.google.com/docs/functions/config-env?gen=2nd
// 값 자체(키 리소스 이름)는 비밀이 아니다 — 실제 키 자료는 KMS 밖으로 나오지 않으며 접근은 IAM이 통제한다.
const kmsKeyName = defineString('PII_KMS_KEY_NAME');

// App Check 정책: off(기본, 운영 호환성 우선) | log(토큰 없어도 통과시키되 경고 로그) |
// enforce(토큰 없으면 거부). onCall({ enforceAppCheck }) 자체는 배포 시 고정되는 옵션이라
// 모드 전환마다 재배포가 필요하다 — 그래서 항상 enforceAppCheck:false로 배포해두고, 이 파라미터
// 값으로 런타임에 세 모드를 오간다(재배포 없이 콘솔에서 파라미터만 바꿔도 됨).
// 권장값: App Check(reCAPTCHA/앱 무결성) 콘솔 설정 전에는 off 유지 → 설정 직후 log로 모니터링
// → 정상 트래픽에서 App Check 토큰 누락이 없음을 확인한 뒤 enforce로 전환.
const appCheckMode = defineString('APP_CHECK_MODE', { default: 'off' });

const REGION = 'asia-northeast3';

function assertAppCheck(request) {
  const mode = appCheckMode.value();
  if (mode !== 'enforce' && mode !== 'log') return;

  if (!request.app) {
    if (mode === 'enforce') {
      throw new HttpsError('failed-precondition', '앱 무결성 검증에 실패했습니다. 앱을 새로고침한 뒤 다시 시도해주세요.');
    }
    console.warn('[submitProtectedSurveyResponse] missing App Check token (mode=log)');
  }
}

export const encryptRespondentPii = onCall({ region: REGION }, async (request) =>
  handleEncryptRespondentPii({ data: request.data, keyName: kmsKeyName.value() }),
);

export const encryptAnswerFields = onCall({ region: REGION }, async (request) =>
  handleEncryptAnswerFields({ data: request.data, keyName: kmsKeyName.value() }),
);

export const revealResponsePii = onCall({ region: REGION }, async (request) =>
  handleRevealResponsePii({
    data: request.data,
    auth: request.auth,
    db: getFirestore(),
    keyName: kmsKeyName.value(),
  }),
);

export const submitProtectedSurveyResponse = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  assertAppCheck(request);
  return handleSubmitProtectedSurveyResponse({
    data: request.data,
    auth: request.auth,
    db: getFirestore(),
    keyName: kmsKeyName.value(),
  });
});
