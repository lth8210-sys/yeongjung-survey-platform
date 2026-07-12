import { httpsCallable } from 'firebase/functions';
import { functionsClient, isFirebaseConfigured } from './config';
import { maskName, maskPhone, maskBirthDate, maskAnswerByQuestion } from '../utils/privacy';
import { logger } from '../utils/logger';

/**
 * 응답 제출 직전 이름/전화/생년월일을 보호한다.
 * - 마스킹(미리보기)은 항상 로컬에서 즉시 계산한다(네트워크 불필요, 실패할 수 없음).
 * - 암호문은 Cloud Functions(encryptRespondentPii, Cloud KMS)를 호출해 얻는다 — 실패해도
 *   설문 제출 자체를 막지 않는다(기존 응답 저장 흐름을 절대 중단시키지 않기 위함). 단,
 *   이 경우 평문을 대신 저장하지 않는다 — piiProtected:false로 표시해 미보호 상태임을
 *   그대로 남긴다("암호화 실패 시 평문 저장 금지" 원칙).
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

  if (!isFirebaseConfigured || !functionsClient) {
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

  if (!isFirebaseConfigured || !functionsClient) {
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
