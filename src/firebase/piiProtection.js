import { httpsCallable } from 'firebase/functions';
import { functionsClient, isFirebaseConfigured } from './config';
import { maskName, maskPhone, maskBirthDate, maskAnswerByQuestion } from '../utils/privacy';
import { logger } from '../utils/logger';

/**
 * ⚠️ 임시 조치(2026-07-14) — 이 플래그가 꺼져 있는 동안(기본값) 이름/전화/생년월일/answers[]
 * 자유서술형 PII 문항은 Firestore에 **평문으로 저장된다**. 이것은 개인정보 보호 문제를
 * 해결한 상태가 아니다 — Cloud Functions(encryptRespondentPii/encryptAnswerFields)가 실제로
 * 배포되지 않은 상태(Spark 플랜)에서 이 호출이 항상 실패하고, 배포되지 않은 Cloud Functions
 * URL은 CORS 헤더 없는 404를 반환하므로 브라우저 콘솔에 "CORS error / Failed to fetch"가
 * 매 제출마다 찍히던 것을 막기 위한 임시 우회일 뿐이다(curl로 직접 확인: OPTIONS/POST 둘 다
 * Access-Control-Allow-Origin 없는 404 — 실제 원인은 CORS 설정이 아니라 "함수가 없음").
 * 이 플래그를 끈 것은 "실패 신호와 불필요한 네트워크 요청을 제거"한 것이지 "개인정보 보호
 * 수준을 높인"것이 아니다 — 평문 저장 위험 자체는 그대로 남아 있다. 자세한 최종 구조(서버
 * 측 암호화, `responses_private` 분리 저장, 관리자 다운로드 시에만 복호화)는
 * `docs/pii-encryption-architecture.md` §11.14 참고. **이 플래그를 켤 때는 반드시 Cloud
 * Functions가 실제로 배포되어 있는지 먼저 확인할 것** — 배포 안 된 채로 켜면 이 절과 똑같은
 * CORS 콘솔 오류가 그대로 재발한다(자동 검증 장치 없음, 운영자가 직접 확인해야 함).
 */
function isPiiEncryptionEnabled() {
  return (
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENABLE_PII_ENCRYPTION === 'true'
  );
}

/**
 * 응답 제출 직전 이름/전화/생년월일을 보호한다.
 * - 마스킹(미리보기)은 항상 로컬에서 즉시 계산한다(네트워크 불필요, 실패할 수 없음).
 * - 암호문은 Cloud Functions(encryptRespondentPii, Cloud KMS)를 호출해 얻는다 — 실패해도
 *   설문 제출 자체를 막지 않는다(기존 응답 저장 흐름을 절대 중단시키지 않기 위함).
 * - piiProtected:false(암호화 안 됨)로 반환되면, 호출부(`src/firebase/surveys.js`의
 *   `buildRespondentPiiFields`)는 **원본을 평문으로 그대로 저장한다**(원본 유실을 막기 위한
 *   의도적 선택 — 2026-07-12 사고 이후 정책, `docs/admin-original-pii-export-fix.md` 참고).
 *   즉 이 함수가 `piiProtected:false`를 반환하는 모든 경우(Cloud Functions 미배포 포함)에
 *   실제 저장값은 "미보호 평문"이지 "저장 안 함"이 아니다 — 위쪽 임시 조치 경고 참고.
 * - VITE_ENABLE_PII_ENCRYPTION이 꺼져 있으면(기본값) 이 호출조차 시도하지 않는다.
 *
 * @param {{ name?: string, phone?: string, birthDate?: string }} identity
 * @returns {Promise<{
 *   nameMasked: string, phoneMasked: string, birthDateMasked: string,
 *   encrypted: { name: string|null, phone: string|null, birthDate: string|null, keyVersion: string, encryptedAt: string } | null,
 *   piiProtected: boolean,
 * }>}
 */
export async function protectRespondentPii({ name = '', phone = '', birthDate = '' } = {}) {
  const nameMasked = name ? maskName(name) : '';
  const phoneMasked = phone ? maskPhone(phone) : '';
  const birthDateMasked = birthDate ? maskBirthDate(birthDate) : '';

  if (!name && !phone && !birthDate) {
    return { nameMasked, phoneMasked, birthDateMasked, encrypted: null, piiProtected: false };
  }

  if (!isPiiEncryptionEnabled() || !isFirebaseConfigured || !functionsClient) {
    return { nameMasked, phoneMasked, birthDateMasked, encrypted: null, piiProtected: false };
  }

  try {
    const encryptRespondentPii = httpsCallable(functionsClient, 'encryptRespondentPii');
    const result = await encryptRespondentPii({ name, phone, birthDate });
    const encrypted = result?.data?.encrypted ?? null;

    if (!encrypted) {
      return { nameMasked, phoneMasked, birthDateMasked, encrypted: null, piiProtected: false };
    }

    return { nameMasked, phoneMasked, birthDateMasked, encrypted, piiProtected: true };
  } catch (error) {
    // 원문(name/phone/birthDate)은 로그에 남기지 않는다 — 오류 코드만 기록한다.
    logger.error('[piiProtection] encryptRespondentPii failed', { code: error?.code ?? 'unknown' });
    return { nameMasked, phoneMasked, birthDateMasked, encrypted: null, piiProtected: false };
  }
}

/**
 * 설문 문항 답변(answers[]) 중 자유서술형 신원 식별 문항의 값을 보호한다.
 * surveys.js가 survey.questions로 대상 문항을 미리 골라(identifyAnswerPiiQuestionIds) 넘겨준다 —
 * 이 파일은 surveys.js를 import하지 않는다(surveys.js가 이미 이 파일을 import하므로 순환 참조를
 * 피하기 위함). protectRespondentPii와 동일한 원칙: 마스킹은 항상 로컬에서 계산하고, 암호화 실패
 * 시에도 평문을 저장하지 않는다(마스킹 값만 남기고 piiProtected:false로 표시).
 *
 * @param {{ questionId: string, value: string, questionTitle?: string, questionType?: string }[]} targets
 * @returns {Promise<{
 *   maskedByQuestionId: Record<string, string>,
 *   fields: { values: Record<string, string>, keyVersion: string, encryptedAt: string, schemaVersion: number } | null,
 *   piiProtected: boolean,
 * }>}
 */
export async function protectAnswerFields(targets = []) {
  const maskedByQuestionId = {};
  targets.forEach(({ questionId, value, questionTitle, questionType }) => {
    maskedByQuestionId[questionId] = maskAnswerByQuestion(value, questionTitle, questionType);
  });

  if (targets.length === 0) {
    return { maskedByQuestionId, fields: null, piiProtected: false };
  }

  if (!isPiiEncryptionEnabled() || !isFirebaseConfigured || !functionsClient) {
    return { maskedByQuestionId, fields: null, piiProtected: false };
  }

  try {
    const encryptAnswerFields = httpsCallable(functionsClient, 'encryptAnswerFields');
    const result = await encryptAnswerFields({
      fields: Object.fromEntries(targets.map(({ questionId, value }) => [questionId, value])),
    });
    const encrypted = result?.data?.encrypted ?? null;

    if (!encrypted) {
      return { maskedByQuestionId, fields: null, piiProtected: false };
    }

    return { maskedByQuestionId, fields: encrypted, piiProtected: true };
  } catch (error) {
    // 원문 답변 값은 로그에 남기지 않는다 — 오류 코드만 기록한다.
    logger.error('[piiProtection] encryptAnswerFields failed', { code: error?.code ?? 'unknown' });
    return { maskedByQuestionId, fields: null, piiProtected: false };
  }
}
