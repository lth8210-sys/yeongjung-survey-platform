/**
 * submitProtectedSurveyResponse의 순수 로직 — Structure A(서버 콜러블 전면 이전).
 *
 * 기존(Structure B) 경로는 유지된다: src/firebase/surveys.js의 submitSurveyResponse()는
 * 삭제하지 않았다(클라이언트 feature flag가 꺼져 있을 때의 폴백, 단계적 전환용).
 *
 * 이 핸들러는 익명 방문자가 호출할 수 있다(auth가 null일 수 있음) — 응답 제출 자체가 비로그인을
 * 전제로 한다. 대신 클라이언트가 보낸 어떤 값도 보안 판단에 신뢰하지 않는다:
 *  - role/currentUserAccess: 신뢰하지 않는다. auth가 있으면 resolveCallerRole()로 서버가 직접
 *    Firestore users/{uid}를 조회해 재계산한다. auth가 없으면(익명 제출) 관리자 정원 초과 허용
 *    권한은 항상 없음으로 취급한다.
 *  - 마스킹값/암호문: 클라이언트가 보내더라도 받지 않는다(입력 스키마에 필드 자체가 없음) —
 *    서버가 answers[]의 원본 답변으로 직접 마스킹·KMS 암호화한다.
 *  - surveyTitle 등 설문 메타데이터: 서버가 방금 읽은 surveys/{surveyId} 문서 값을 쓴다.
 *
 * 트랜잭션 불변조건(기존 클라이언트 트랜잭션과 동일하게 유지 — docs/pii-encryption-architecture.md
 * §11 참조):
 *  1. 응답 1건 생성 시 surveys.responseCount 정확히 +1
 *  2. 동일 clientSubmitId 재호출은 새 문서를 만들지 않고 기존 responseId를 반환한다(idempotency)
 *  3. 중복신청 락(applicationApplicantLocks)과 응답 생성은 같은 트랜잭션에서 함께 성공/실패한다
 *  4. 슬롯 락(applicationSlotLocks)과 응답 생성은 같은 트랜잭션에서 함께 성공/실패한다
 *  5. 연령 quota 카운트 증가와 응답 생성은 같은 트랜잭션에서 함께 성공/실패한다
 *  6. 선택형 문항 정원(optionQuotaCounts) 증가와 응답 생성은 같은 트랜잭션에서 함께 성공/실패한다
 *  7. 게시(published) 상태가 아니거나 마감된 설문은 거부한다
 *  8. PII(식별 요약 + answers[] 자유서술형) 암호화 실패 시 트랜잭션을 아예 시작하지 않는다
 *     (평문 fallback 금지 — 이 부분이 기존 클라이언트 경로와의 유일한 의도적 동작 차이다.
 *     기존 경로는 암호화 실패 시에도 마스킹만 하고 제출은 계속 진행했다).
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { encryptField } from './kms.js';
import { maskName, maskPhone, maskBirthDate, maskAnswerByQuestion } from './masking.js';
import { resolveCallerRole } from './roles.js';
import { QUESTION_TYPES, RESPONSE_STATUSES, SURVEY_STATUSES } from './survey/constants.js';
import {
  mapSurveyForSubmission,
  getPublicSurveyState,
  getQuotaSummary,
  createDefaultAgeQuotaConfig,
  normalizeAgeQuotaConfig,
  createEmptyAgeQuotaCounts,
  normalizeAgeQuotaCounts,
  resolveAgeQuota,
  QUOTA_CLOSE_MODES,
  normalizeOptionQuotaCounts,
  isOptionQuotaQuestion,
  getQuestionOptionItems,
  buildOptionQuotaKey,
  extractApplicantIdentity,
  extractSlotSelections,
  identifyAnswerPiiQuestionIds,
  buildAnswerPiiTargets,
  hashString,
  buildApplicantLockDocumentId,
  buildApplicationSlotLockDocumentId,
  buildClientSubmitLockDocumentId,
  buildClientSubmitResponseDocumentId,
} from './survey/submission.js';

const MAX_ANSWERS = 500;
const MAX_ANSWER_STRING_LENGTH = 5000;
const MAX_ARRAY_FIELD_LENGTH = 500;
const MAX_ID_LENGTH = 300;

function toTrimmedString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizeAnswerValue(value) {
  if (typeof value === 'string') return value.slice(0, MAX_ANSWER_STRING_LENGTH);
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => (typeof item === 'string' ? item.slice(0, 500) : item));
  }
  return '';
}

function sanitizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').slice(0, MAX_ARRAY_FIELD_LENGTH).map((item) => item.slice(0, MAX_ID_LENGTH))
    : [];
}

/**
 * 클라이언트 입력을 검증하고, 서버가 신뢰할 필드만 남긴 안전한 사본을 반환한다.
 * 화이트리스트에 없는 필드(currentUserAccess, surveyTitle, respondent의 마스킹값/암호문 등)는
 * 여기서 전부 버려진다 — 이후 어떤 코드도 원본 data를 다시 참조하지 않는다.
 */
function parseSubmitInput(data) {
  const surveyId = toTrimmedString(data?.surveyId, 200);
  if (!surveyId) {
    throw new HttpsError('invalid-argument', 'surveyId가 필요합니다.');
  }

  const clientSubmitId = toTrimmedString(data?.clientSubmitId, 200);
  if (!clientSubmitId) {
    throw new HttpsError('invalid-argument', 'clientSubmitId가 필요합니다.');
  }

  const rawAnswers = Array.isArray(data?.answers) ? data.answers : [];
  if (rawAnswers.length > MAX_ANSWERS) {
    throw new HttpsError('invalid-argument', 'answers 항목이 너무 많습니다.');
  }

  const answers = rawAnswers
    .filter((item) => item && typeof item.questionId === 'string' && item.questionId.trim())
    .map((item) => ({
      questionId: toTrimmedString(item.questionId, MAX_ID_LENGTH),
      questionTitle: toTrimmedString(item.questionTitle, 300),
      questionDescription: toTrimmedString(item.questionDescription, 1000),
      questionType: toTrimmedString(item.questionType, 50),
      answer: sanitizeAnswerValue(item.answer),
    }));

  const responseMode = data?.responseMode === 'paged' ? 'paged' : 'single';
  const submittedFrom = toTrimmedString(data?.respondent?.submittedFrom, 50) || 'web';

  const rawQuotaInput = data?.quotaInput;
  const quotaInput =
    rawQuotaInput && typeof rawQuotaInput === 'object' && !Array.isArray(rawQuotaInput)
      ? { birthYear: rawQuotaInput.birthYear }
      : null;

  return {
    surveyId,
    clientSubmitId,
    answers,
    respondent: { submittedFrom },
    responseMode,
    visibleQuestionIds: sanitizeStringArray(data?.visibleQuestionIds),
    visibleSectionIds: sanitizeStringArray(data?.visibleSectionIds),
    skippedQuestionIds: sanitizeStringArray(data?.skippedQuestionIds),
    quotaInput,
  };
}

async function encryptIdentityAndAnswerPii({ questions, answers, keyName }) {
  const applicantIdentity = extractApplicantIdentity(questions, answers);
  const nameMasked = applicantIdentity.name ? maskName(applicantIdentity.name) : '';
  const phoneMasked = applicantIdentity.phone ? maskPhone(applicantIdentity.phone) : '';
  const birthDateMasked = applicantIdentity.birthDate ? maskBirthDate(applicantIdentity.birthDate) : '';

  const answerPiiQuestionIds = identifyAnswerPiiQuestionIds(questions);
  const answerPiiTargets = buildAnswerPiiTargets(questions, answerPiiQuestionIds, answers);
  const maskedByQuestionId = {};
  answerPiiTargets.forEach(({ questionId, value, questionTitle, questionType }) => {
    maskedByQuestionId[questionId] = maskAnswerByQuestion(value, questionTitle, questionType);
  });

  const hasIdentityPii = Boolean(applicantIdentity.name || applicantIdentity.phone || applicantIdentity.birthDate);
  const hasAnswerPii = answerPiiTargets.length > 0;

  let applicantPii = null;
  let answersPii = null;

  if (hasIdentityPii || hasAnswerPii) {
    // 8/9번 원칙: 암호화 실패 시 응답 전체 저장 실패, 평문 fallback 금지.
    // 그래서 이 블록 전체를 try 없이 그대로 둔다 — encryptField가 던지면 handleSubmit이
    // 그대로 HttpsError로 전파해 트랜잭션을 아예 시작하지 않는다.
    const [nameCt, phoneCt, birthDateCt, ...answerCiphertexts] = await Promise.all([
      applicantIdentity.name ? encryptField(applicantIdentity.name, keyName) : Promise.resolve(null),
      applicantIdentity.phone ? encryptField(applicantIdentity.phone, keyName) : Promise.resolve(null),
      applicantIdentity.birthDate ? encryptField(applicantIdentity.birthDate, keyName) : Promise.resolve(null),
      ...answerPiiTargets.map((target) => encryptField(target.value, keyName)),
    ]);

    const encryptedAt = new Date().toISOString();

    if (hasIdentityPii) {
      applicantPii = { name: nameCt, phone: phoneCt, birthDate: birthDateCt, keyVersion: keyName, encryptedAt };
    }

    if (hasAnswerPii) {
      const values = {};
      answerPiiTargets.forEach((target, index) => {
        values[target.questionId] = answerCiphertexts[index];
      });
      answersPii = { values, keyVersion: keyName, encryptedAt, schemaVersion: 1 };
    }
  }

  const protectedAnswers = answers.map((answerItem) => {
    if (!answerItem || !answerPiiQuestionIds.has(answerItem.questionId)) return answerItem;
    const masked = maskedByQuestionId[answerItem.questionId];
    if (masked === undefined) return answerItem;
    const hasCiphertext = Boolean(answersPii?.values?.[answerItem.questionId]);
    return { ...answerItem, answer: masked, piiProtected: hasCiphertext };
  });

  return {
    applicantIdentity,
    nameMasked,
    phoneMasked,
    birthDateMasked,
    applicantPii,
    answersPii,
    protectedAnswers,
    piiProtected: Boolean(applicantPii),
  };
}

export async function handleSubmitProtectedSurveyResponse({ data, auth, db, keyName }) {
  const input = parseSubmitInput(data);

  const surveyRef = db.collection('surveys').doc(input.surveyId);
  const surveySnapshot = await surveyRef.get();

  if (!surveySnapshot.exists) {
    throw new HttpsError('not-found', '설문 정보를 찾을 수 없습니다.');
  }

  const survey = mapSurveyForSubmission(surveySnapshot);

  if (getPublicSurveyState(survey).key !== 'open') {
    throw new HttpsError('failed-precondition', '현재 응답을 받을 수 없는 설문입니다.');
  }

  // 서버가 auth 토큰으로 직접 역할을 재계산한다 — 클라이언트가 보낸 role/currentUserAccess는
  // 입력 스키마에 아예 없으므로 여기서 신뢰할 여지 자체가 없다. 익명 제출(auth === null)은
  // 항상 관리자 정원 초과 허용 권한이 없다.
  const canAdminOverride = auth
    ? await resolveCallerRole(db, auth).then((caller) => caller.role === 'admin' || caller.role === 'super_admin')
    : false;

  const responseRef = db
    .collection('responses')
    .doc(buildClientSubmitResponseDocumentId(input.surveyId, input.clientSubmitId));
  const clientSubmitLockRef = surveyRef
    .collection('clientSubmitLocks')
    .doc(buildClientSubmitLockDocumentId(input.clientSubmitId));

  const applicantIdentity = extractApplicantIdentity(survey.questions, input.answers);

  if ((survey.duplicateCheckEnabled || survey.slotDuplicateCheckEnabled || survey.oneSlotPerPersonEnabled) && !applicantIdentity.key) {
    throw new HttpsError(
      'failed-precondition',
      '중복 신청 방지를 사용 중인 폼입니다. 연락처 또는 이름+생년월일 정보를 입력한 뒤 다시 신청해주세요.',
    );
  }

  // KMS 호출은 트랜잭션 재시도 루프 밖에서 1회만 수행한다(기존 클라이언트 구현과 동일한 이유 —
  // 네트워크 호출을 트랜잭션 안에 넣지 않기 위함). 실패하면 여기서 그대로 던져 트랜잭션 자체를
  // 시작하지 않는다(8/9번 원칙).
  let piiResult;
  try {
    piiResult = await encryptIdentityAndAnswerPii({ questions: survey.questions, answers: input.answers, keyName });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('[submitProtectedSurveyResponse] PII encryption failed', { message: error?.message ?? String(error) });
    throw new HttpsError('internal', 'PII 암호화에 실패해 응답을 저장하지 못했습니다.');
  }

  const slotSelections = extractSlotSelections(survey.questions, input.answers, survey.optionQuotaCounts);

  const responseId = await db.runTransaction(async (transaction) => {
    const clientSubmitLockSnapshot = await transaction.get(clientSubmitLockRef);
    if (clientSubmitLockSnapshot.exists) {
      return responseRef.id;
    }

    const surveySnapshotInTx = await transaction.get(surveyRef);
    if (!surveySnapshotInTx.exists) {
      throw new HttpsError('not-found', '설문 정보를 찾을 수 없습니다.');
    }
    const surveyInTx = mapSurveyForSubmission(surveySnapshotInTx);

    const quotaConfigRef = surveyRef.collection('quotaConfig').doc('main');
    const quotaCountsRef = surveyRef.collection('quotaCounts').doc('main');
    const [quotaConfigSnapshot, quotaCountsSnapshot] = await Promise.all([
      transaction.get(quotaConfigRef),
      transaction.get(quotaCountsRef),
    ]);
    const quotaConfig = normalizeAgeQuotaConfig(
      quotaConfigSnapshot.exists ? quotaConfigSnapshot.data() : createDefaultAgeQuotaConfig(),
    );
    const quotaCounts = normalizeAgeQuotaCounts(
      quotaCountsSnapshot.exists ? quotaCountsSnapshot.data() : createEmptyAgeQuotaCounts(quotaConfig),
      quotaConfig,
    );

    if (getPublicSurveyState(surveyInTx).key !== 'open') {
      throw new HttpsError('failed-precondition', '현재 응답을 받을 수 없는 설문입니다.');
    }

    const quotaSummary = getQuotaSummary(surveyInTx);
    if (quotaSummary.quotaEnabled && quotaSummary.maxResponses && quotaSummary.isFull) {
      throw new HttpsError('resource-exhausted', '정원이 마감되어 더 이상 응답을 받을 수 없습니다.');
    }

    const nextOptionQuotaCounts = { ...normalizeOptionQuotaCounts(surveyInTx.optionQuotaCounts) };
    const applicantLockWrites = [];
    const slotLockWrites = [];

    if (applicantIdentity.key && (surveyInTx.duplicateCheckEnabled || surveyInTx.oneSlotPerPersonEnabled)) {
      const applicantLockRef = surveyRef
        .collection('applicationApplicantLocks')
        .doc(buildApplicantLockDocumentId(applicantIdentity.key));
      const applicantLockSnapshot = await transaction.get(applicantLockRef);

      if (applicantLockSnapshot.exists) {
        throw new HttpsError(
          'already-exists',
          surveyInTx.duplicateCheckEnabled
            ? `이미 신청된 정보가 있습니다. ${applicantIdentity.keyLabel} 중복 신청은 허용되지 않습니다.`
            : '이 폼은 1인 1슬롯만 신청할 수 있습니다. 이미 신청된 정보가 있습니다.',
        );
      }

      applicantLockWrites.push({
        ref: applicantLockRef,
        data: {
          surveyId: input.surveyId,
          applicantHash: hashString(applicantIdentity.key),
          applicantKeyLabel: applicantIdentity.keyLabel,
          lockType: surveyInTx.duplicateCheckEnabled ? 'form_duplicate' : 'one_slot_per_person',
          responseId: responseRef.id,
          createdAt: FieldValue.serverTimestamp(),
        },
      });
    }

    if (surveyInTx.slotDuplicateCheckEnabled && applicantIdentity.key && slotSelections.length > 0) {
      for (const slotSelection of slotSelections) {
        const slotLockRef = surveyRef
          .collection('applicationSlotLocks')
          .doc(buildApplicationSlotLockDocumentId(slotSelection.questionId, slotSelection.slotValue, applicantIdentity.key));
        const slotLockSnapshot = await transaction.get(slotLockRef);

        if (slotLockSnapshot.exists) {
          throw new HttpsError(
            'already-exists',
            `"${slotSelection.slotLabel ?? '선택한 슬롯'}"은 이미 같은 신청 정보로 접수되어 다시 신청할 수 없습니다.`,
          );
        }

        slotLockWrites.push({
          ref: slotLockRef,
          data: {
            surveyId: input.surveyId,
            questionId: slotSelection.questionId,
            slotValue: slotSelection.slotValue,
            slotLabel: slotSelection.slotLabel,
            applicantHash: hashString(applicantIdentity.key),
            responseId: responseRef.id,
            createdAt: FieldValue.serverTimestamp(),
          },
        });
      }
    }

    input.answers.forEach((answerItem) => {
      const matchedQuestion = surveyInTx.questions.find((question) => question.id === answerItem.questionId);
      if (!matchedQuestion || !isOptionQuotaQuestion(matchedQuestion)) return;
      if (
        matchedQuestion.type !== QUESTION_TYPES.SINGLE_CHOICE &&
        matchedQuestion.type !== QUESTION_TYPES.DROPDOWN &&
        matchedQuestion.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE
      ) {
        return;
      }

      const selectedOption = typeof answerItem.answer === 'string' ? answerItem.answer.trim() : '';
      if (!selectedOption || !matchedQuestion.options.includes(selectedOption)) return;

      const optionItems = getQuestionOptionItems(matchedQuestion, nextOptionQuotaCounts);
      const matchedOption = optionItems.find((option) => option.value === selectedOption);
      if (!matchedOption?.capacity) return;

      if (matchedOption.isClosed) {
        throw new HttpsError('resource-exhausted', `선택한 항목 "${matchedOption.label}"은 이미 마감되었습니다.`);
      }

      nextOptionQuotaCounts[buildOptionQuotaKey(matchedQuestion.id, selectedOption)] = matchedOption.currentCount + 1;
    });

    let responseQuota = null;
    let nextQuotaCounts = quotaCounts;

    if (quotaConfig.enabled) {
      const resolvedQuota = resolveAgeQuota(input.quotaInput, quotaConfig);
      if (!resolvedQuota.valid) {
        throw new HttpsError('failed-precondition', '출생년도를 확인해주세요.');
      }

      const target = quotaConfig.targets?.[resolvedQuota.ageGroup.id] ?? 0;
      const currentCount = quotaCounts.cells?.[resolvedQuota.ageGroup.id] ?? 0;
      const isClosedCell = target > 0 && currentCount >= target;

      if (
        isClosedCell &&
        (quotaConfig.closeMode === QUOTA_CLOSE_MODES.BLOCK ||
          (quotaConfig.closeMode === QUOTA_CLOSE_MODES.ADMIN_ONLY && !canAdminOverride))
      ) {
        throw new HttpsError('resource-exhausted', '선택하신 연령대의 목표 응답이 마감되었습니다. 참여해 주셔서 감사합니다.');
      }

      responseQuota = {
        birthYear: resolvedQuota.birthYear,
        age: resolvedQuota.age,
        ageGroupId: resolvedQuota.ageGroup.id,
        ageGroupLabel: resolvedQuota.ageGroup.label,
        isOverQuota: isClosedCell,
      };
      nextQuotaCounts = {
        ...quotaCounts,
        total: (quotaCounts.total ?? 0) + 1,
        cells: { ...quotaCounts.cells, [resolvedQuota.ageGroup.id]: currentCount + 1 },
      };
    }

    const nextResponseCount = quotaSummary.responseCount + 1;
    const shouldCloseAfterSubmit =
      quotaSummary.quotaEnabled && quotaSummary.maxResponses && nextResponseCount >= quotaSummary.maxResponses;

    transaction.set(responseRef, {
      surveyId: input.surveyId,
      surveyTitle: surveyInTx.title,
      clientSubmitId: input.clientSubmitId,
      surveyType: surveyInTx.formType ?? '',
      surveyOwnerEmail: surveyInTx.ownerEmail ?? '',
      surveyOwnerUid: surveyInTx.ownerUid ?? '',
      surveyCreatedByEmail: surveyInTx.createdByEmail ?? '',
      surveyCreatedByUid: surveyInTx.createdByUid ?? '',
      surveyDeleted: false,
      surveyPermanentlyDeleted: false,
      hiddenFromDefaultList: false,
      answers: piiResult.protectedAnswers,
      status: RESPONSE_STATUSES.SUBMITTED,
      responseMode: input.responseMode,
      visibleQuestionIds: input.visibleQuestionIds,
      visibleSectionIds: input.visibleSectionIds,
      skippedQuestionIds: input.skippedQuestionIds,
      quota: responseQuota,
      respondent: {
        ...input.respondent,
        clientSubmitId: input.clientSubmitId,
        applicantNameMasked: piiResult.nameMasked,
        applicantPhoneMasked: piiResult.phoneMasked,
        applicantBirthDateMasked: piiResult.birthDateMasked,
        applicantPii: piiResult.applicantPii,
        piiProtected: piiResult.piiProtected,
        answersPii: piiResult.answersPii,
        applicantKey: applicantIdentity.key,
        applicantKeyLabel: applicantIdentity.keyLabel,
        slotSelections,
      },
      respondentName: piiResult.nameMasked,
      respondentPhone: piiResult.phoneMasked,
      selectedSlotLabel: slotSelections[0]?.slotLabel ?? '',
      adminNote: '',
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: new Date().toISOString(),
    });

    transaction.set(clientSubmitLockRef, {
      surveyId: input.surveyId,
      clientSubmitIdHash: hashString(input.clientSubmitId),
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.update(surveyRef, {
      optionQuotaCounts: nextOptionQuotaCounts,
      responseCount: nextResponseCount,
      status: shouldCloseAfterSubmit ? SURVEY_STATUSES.CLOSED : surveyInTx.storedStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (quotaConfig.enabled) {
      transaction.set(quotaCountsRef, { ...nextQuotaCounts, updatedAt: FieldValue.serverTimestamp() });
    }

    applicantLockWrites.forEach((lock) => transaction.set(lock.ref, lock.data));
    slotLockWrites.forEach((lock) => transaction.set(lock.ref, lock.data));

    return responseRef.id;
  });

  return { responseId };
}
