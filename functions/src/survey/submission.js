/**
 * SYNC REQUIRED: 아래 각 함수는 src/firebase/surveys.js의 동일 이름 함수와 로직·상수값이
 * 완전히 같아야 한다(quota 판정·중복신청 판정이 클라이언트/서버에서 달라지면 정원 회귀가 생긴다).
 * functions/src/masking.js·roles.js와 동일한 기존 관례에 따라 전체 복제한다 — src/를 import할
 * 수 없는 별도 Node 패키지 제약 때문이다(functions/index.js 상단 주석 참조).
 *
 * 이 파일은 submitProtectedSurveyResponse 콜러블(서버 트랜잭션 이전, Structure A)에서만 쓰인다.
 */

import {
  FORM_TYPE_CONFIGS,
  FORM_TYPES,
  QUESTION_TYPES,
  SURVEY_STATUSES,
} from './constants.js';
import { isNonResponseQuestionType, normalizeQuestionsForSubmission } from './normalize.js';

const LEGACY_PUBLISHED_STATUSES = ['active'];

export const QUOTA_CLOSE_MODES = {
  BLOCK: 'block',
  ALLOW_OVER: 'allow_over',
  ADMIN_ONLY: 'admin_only',
};

export const DEFAULT_AGE_QUOTA_CONFIG = {
  enabled: false,
  totalTarget: 520,
  baseYear: 2026,
  closeMode: QUOTA_CLOSE_MODES.BLOCK,
  ageGroups: [
    { id: 'age_0_19', label: '0~19세', minAge: 0, maxAge: 19 },
    { id: 'age_20_39', label: '20~39세', minAge: 20, maxAge: 39 },
    { id: 'age_40_64', label: '40~64세', minAge: 40, maxAge: 64 },
    { id: 'age_65_plus', label: '65세 이상', minAge: 65, maxAge: null },
  ],
  targets: {},
};

function createLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── 설문 상태/구성 ─────────────────────────────────────────────────────────

export function normalizeSurveyStatus(status) {
  if (status === SURVEY_STATUSES.DELETED) return SURVEY_STATUSES.DELETED;
  if (status === SURVEY_STATUSES.DRAFT) return SURVEY_STATUSES.DRAFT;
  if (status === SURVEY_STATUSES.PUBLISHED || LEGACY_PUBLISHED_STATUSES.includes(status)) {
    return SURVEY_STATUSES.PUBLISHED;
  }
  if (status === SURVEY_STATUSES.CLOSED) return SURVEY_STATUSES.CLOSED;
  return SURVEY_STATUSES.DRAFT;
}

export function normalizeFormType(formType) {
  return Object.values(FORM_TYPES).includes(formType) ? formType : FORM_TYPES.GENERAL_SURVEY;
}

export function isApplicationFormType(formType) {
  const normalizedFormType = normalizeFormType(formType);
  return (
    normalizedFormType === FORM_TYPES.TARGETED_PARTICIPATION_APPLICATION ||
    normalizedFormType === FORM_TYPES.GENERAL_APPLICATION
  );
}

export function getDraftSurveyMessage(formType) {
  return isApplicationFormType(formType) ? '아직 공개되지 않은 신청서입니다.' : '공개되지 않은 설문입니다.';
}

export function getClosedSurveyMessage(formType) {
  return isApplicationFormType(formType) ? '접수가 마감되었습니다.' : '응답이 마감되었습니다.';
}

/**
 * src/firebase/surveys.js의 normalizeSurveyConfiguration()보다 좁다 — 제출 트랜잭션이 실제로
 * 읽는 필드만 남겼다(quotaEnabled/maxResponses/responseCount/duplicateCheckEnabled/
 * slotDuplicateCheckEnabled/oneSlotPerPersonEnabled/opensAt/closesAt). branchingEnabled 등
 * 표시 전용 필드는 제출 트랜잭션 어디에서도 읽지 않으므로 옮기지 않았다.
 */
function normalizeSurveyConfigurationForSubmission(survey = {}) {
  const safeSurvey = survey && typeof survey === 'object' && !Array.isArray(survey) ? survey : {};
  const normalizedFormType = normalizeFormType(safeSurvey.formType);
  const defaults = FORM_TYPE_CONFIGS[normalizedFormType].defaults;
  const maxResponses =
    typeof safeSurvey.maxResponses === 'number' && Number.isFinite(safeSurvey.maxResponses)
      ? Math.max(1, Math.floor(safeSurvey.maxResponses))
      : null;
  const responseCount =
    typeof safeSurvey.responseCount === 'number' && Number.isFinite(safeSurvey.responseCount)
      ? Math.max(0, Math.floor(safeSurvey.responseCount))
      : 0;
  const normalizeDateTimeField = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

  return {
    formType: normalizedFormType,
    quotaEnabled: typeof safeSurvey.quotaEnabled === 'boolean' ? safeSurvey.quotaEnabled : defaults.quotaEnabled,
    duplicateCheckEnabled:
      typeof safeSurvey.duplicateCheckEnabled === 'boolean'
        ? safeSurvey.duplicateCheckEnabled
        : defaults.duplicateCheckEnabled,
    slotDuplicateCheckEnabled:
      typeof safeSurvey.slotDuplicateCheckEnabled === 'boolean'
        ? safeSurvey.slotDuplicateCheckEnabled
        : defaults.slotDuplicateCheckEnabled,
    oneSlotPerPersonEnabled:
      typeof safeSurvey.oneSlotPerPersonEnabled === 'boolean'
        ? safeSurvey.oneSlotPerPersonEnabled
        : defaults.oneSlotPerPersonEnabled,
    maxResponses,
    responseCount,
    opensAt: normalizeDateTimeField(safeSurvey.opensAt),
    closesAt: normalizeDateTimeField(safeSurvey.closesAt),
  };
}

function toComparableTime(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isQuotaReached(survey = {}) {
  const config = normalizeSurveyConfigurationForSubmission(survey);
  if (!config.quotaEnabled || !config.maxResponses) return false;
  return config.responseCount >= config.maxResponses;
}

export function getEffectiveSurveyStatus(survey = {}) {
  const safeSurvey = survey && typeof survey === 'object' && !Array.isArray(survey) ? survey : {};
  if (safeSurvey.deleted || safeSurvey.status === SURVEY_STATUSES.DELETED) return SURVEY_STATUSES.DELETED;
  if (isQuotaReached(survey)) return SURVEY_STATUSES.CLOSED;
  return normalizeSurveyStatus(safeSurvey.status);
}

export function getQuotaSummary(survey = {}) {
  const config = normalizeSurveyConfigurationForSubmission(survey);
  return {
    quotaEnabled: config.quotaEnabled,
    responseCount: config.responseCount,
    maxResponses: config.maxResponses,
    isFull: isQuotaReached({ ...survey, ...config }),
  };
}

/**
 * src/firebase/surveys.js의 getPublicSurveyState()와 동일 판정. 제출 가능 여부(key === 'open')만
 * submitProtectedSurveyResponse가 실제로 사용한다.
 */
export function getPublicSurveyState(survey = {}, now = Date.now()) {
  const safeSurvey = survey && typeof survey === 'object' && !Array.isArray(survey) ? survey : {};
  const normalizedStatus = normalizeSurveyStatus(safeSurvey.status);
  const quotaSummary = getQuotaSummary(safeSurvey);
  const opensAt = toComparableTime(safeSurvey.opensAt);
  const closesAt = toComparableTime(safeSurvey.closesAt);

  if (normalizedStatus === SURVEY_STATUSES.DELETED || safeSurvey.deleted) {
    return { key: 'deleted', message: '삭제되었거나 더 이상 공개되지 않는 설문입니다.', canSubmit: false };
  }
  if (normalizedStatus === SURVEY_STATUSES.DRAFT) {
    return { key: 'draft', message: getDraftSurveyMessage(safeSurvey.formType), canSubmit: false };
  }
  if (normalizedStatus === SURVEY_STATUSES.CLOSED || quotaSummary.isFull || (closesAt && now > closesAt)) {
    return { key: 'closed', message: getClosedSurveyMessage(safeSurvey.formType), canSubmit: false };
  }
  if (opensAt && now < opensAt) {
    return {
      key: 'scheduled',
      message: isApplicationFormType(safeSurvey.formType) ? '접수 예정입니다.' : '응답 예정입니다.',
      canSubmit: false,
    };
  }

  return {
    key: 'open',
    message: isApplicationFormType(safeSurvey.formType) ? '현재 접수 중입니다.' : '현재 응답을 받고 있습니다.',
    canSubmit: true,
  };
}

/**
 * src/firebase/surveys.js의 mapSurveyDoc()보다 좁다 — sections 정렬은 제출 트랜잭션이 읽지
 * 않으므로 생략했다(표시 전용). 대신 questions는 normalizeQuestionsForSubmission으로 정규화한다.
 */
export function mapSurveyForSubmission(snapshot) {
  const data = snapshot.data() ?? {};
  const ownerUid = data.ownerUid ?? data.createdByUid ?? data.ownerId ?? data.userId ?? data.createdBy?.uid ?? '';
  const createdByUid = data.createdByUid ?? data.createdBy?.uid ?? data.ownerUid ?? data.ownerId ?? data.userId ?? '';
  const ownerEmail = data.ownerEmail ?? data.createdByEmail ?? data.createdBy?.email ?? '';
  const createdByEmail = data.createdByEmail ?? data.createdBy?.email ?? data.ownerEmail ?? '';
  const config = normalizeSurveyConfigurationForSubmission(data);

  return {
    id: snapshot.id,
    title: typeof data.title === 'string' ? data.title : '',
    deleted: Boolean(data.deleted),
    storedStatus: normalizeSurveyStatus(data.status),
    status: getEffectiveSurveyStatus({ ...data, ...config }),
    formType: config.formType,
    quotaEnabled: config.quotaEnabled,
    duplicateCheckEnabled: config.duplicateCheckEnabled,
    slotDuplicateCheckEnabled: config.slotDuplicateCheckEnabled,
    oneSlotPerPersonEnabled: config.oneSlotPerPersonEnabled,
    maxResponses: config.maxResponses,
    responseCount: config.responseCount,
    opensAt: config.opensAt,
    closesAt: config.closesAt,
    ownerUid,
    createdByUid,
    ownerEmail,
    createdByEmail,
    optionQuotaCounts: normalizeOptionQuotaCounts(data.optionQuotaCounts),
    questions: normalizeQuestionsForSubmission(data.questions),
  };
}

// ─── 연령 quota ─────────────────────────────────────────────────────────────

function normalizeQuotaNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : fallback;
}

function normalizeQuotaId(value, fallback) {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || fallback;
}

export function createDefaultAgeQuotaConfig(overrides = {}) {
  const baseConfig = { ...DEFAULT_AGE_QUOTA_CONFIG, ageGroups: DEFAULT_AGE_QUOTA_CONFIG.ageGroups.map((g) => ({ ...g })) };
  const totalTarget = normalizeQuotaNumber(overrides.totalTarget ?? baseConfig.totalTarget, 520);
  const ageGroups = Array.isArray(overrides.ageGroups) ? overrides.ageGroups : baseConfig.ageGroups;
  const targets = ageGroups.reduce((result, ageGroup) => {
    const ageGroupId = normalizeQuotaId(ageGroup.id, createLocalId('age'));
    result[ageGroupId] = 0;
    return result;
  }, {});

  return normalizeAgeQuotaConfig({ ...baseConfig, ...overrides, totalTarget, ageGroups, targets: overrides.targets ?? targets });
}

export function normalizeAgeQuotaConfig(config = {}) {
  const safeConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const fallback = DEFAULT_AGE_QUOTA_CONFIG;
  const ageGroupsSource =
    Array.isArray(safeConfig.ageGroups) && safeConfig.ageGroups.length > 0 ? safeConfig.ageGroups : fallback.ageGroups;
  const ageGroups = ageGroupsSource.map((group, index) => {
    const minAge = Number(group?.minAge);
    const rawMaxAge = group?.maxAge;
    const maxAge = rawMaxAge === null || rawMaxAge === undefined || rawMaxAge === '' ? null : Number(rawMaxAge);

    return {
      id: normalizeQuotaId(group?.id, `age_${index + 1}`),
      label: String(group?.label ?? `연령대 ${index + 1}`).trim() || `연령대 ${index + 1}`,
      minAge: Number.isFinite(minAge) ? Math.max(0, Math.floor(minAge)) : 0,
      maxAge: Number.isFinite(maxAge) ? Math.max(0, Math.floor(maxAge)) : null,
    };
  });
  const sourceTargets =
    safeConfig.targets && typeof safeConfig.targets === 'object' && !Array.isArray(safeConfig.targets) ? safeConfig.targets : {};
  const targets = ageGroups.reduce((result, ageGroup) => {
    result[ageGroup.id] = normalizeQuotaNumber(sourceTargets?.[ageGroup.id], 0);
    return result;
  }, {});

  return {
    enabled: Boolean(safeConfig.enabled),
    totalTarget: normalizeQuotaNumber(safeConfig.totalTarget, 0),
    baseYear: normalizeQuotaNumber(safeConfig.baseYear, new Date().getFullYear()),
    closeMode: Object.values(QUOTA_CLOSE_MODES).includes(safeConfig.closeMode) ? safeConfig.closeMode : QUOTA_CLOSE_MODES.BLOCK,
    ageGroups,
    targets,
  };
}

export function createEmptyAgeQuotaCounts(config = {}) {
  const normalizedConfig = normalizeAgeQuotaConfig(config);
  return {
    total: 0,
    cells: normalizedConfig.ageGroups.reduce((result, ageGroup) => {
      result[ageGroup.id] = 0;
      return result;
    }, {}),
  };
}

export function normalizeAgeQuotaCounts(counts = {}, config = {}) {
  const emptyCounts = createEmptyAgeQuotaCounts(config);
  const safeCounts = counts && typeof counts === 'object' && !Array.isArray(counts) ? counts : {};

  return {
    ...emptyCounts,
    total: normalizeQuotaNumber(safeCounts.total, emptyCounts.total),
    cells: Object.keys(emptyCounts.cells).reduce((result, ageGroupId) => {
      result[ageGroupId] = normalizeQuotaNumber(safeCounts.cells?.[ageGroupId], 0);
      return result;
    }, {}),
  };
}

export function resolveAgeQuota(input = {}, config = {}) {
  const normalizedConfig = normalizeAgeQuotaConfig(config);
  const rawBirthYear = typeof input === 'object' && input !== null ? input.birthYear : input;
  const trimmedBirthYear = typeof rawBirthYear === 'string' ? rawBirthYear.trim() : rawBirthYear;
  const birthYear =
    trimmedBirthYear === '' || trimmedBirthYear === null || trimmedBirthYear === undefined ? NaN : Number(trimmedBirthYear);
  const age = Number.isFinite(birthYear) ? normalizedConfig.baseYear - Math.floor(birthYear) : null;
  const ageGroup = Number.isFinite(age)
    ? normalizedConfig.ageGroups.find((group) => age >= group.minAge && (group.maxAge === null || age <= group.maxAge)) ?? null
    : null;

  if (!ageGroup || !Number.isFinite(age) || age < 0) {
    return { valid: false, birthYear: Number.isFinite(birthYear) ? Math.floor(birthYear) : null, age, ageGroup };
  }

  return { valid: true, birthYear: Math.floor(birthYear), age, ageGroup };
}

// ─── 선택형 문항 quota(슬롯 정원) ────────────────────────────────────────────

export function buildOptionQuotaKey(questionId, optionValue) {
  return `${questionId}::${optionValue}`;
}

export function normalizeOptionQuotaCounts(optionQuotaCounts = {}) {
  if (!optionQuotaCounts || typeof optionQuotaCounts !== 'object' || Array.isArray(optionQuotaCounts)) {
    return {};
  }

  return Object.entries(optionQuotaCounts).reduce((result, [key, value]) => {
    const normalizedValue = Number(value);
    if (typeof key === 'string' && key.trim() && Number.isFinite(normalizedValue) && normalizedValue >= 0) {
      result[key] = Math.floor(normalizedValue);
    }
    return result;
  }, {});
}

export function getQuestionOptionItems(question = {}, optionQuotaCounts = {}) {
  const normalizedCounts = normalizeOptionQuotaCounts(optionQuotaCounts);

  return (question.options ?? [])
    .map((optionLabel) => {
      const optionSetting = question.optionSettings?.[optionLabel] ?? {};
      const capacity = optionSetting.capacity ?? null;
      const currentCount = normalizedCounts[buildOptionQuotaKey(question.id, optionLabel)] ?? 0;
      const isClosed = Boolean(capacity) && currentCount >= capacity;

      return {
        label: question.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE ? optionSetting.title || optionLabel : optionLabel,
        value: optionLabel,
        capacity,
        currentCount,
        isClosed,
        title: optionSetting.title || optionLabel,
        sortOrder: optionSetting.sortOrder ?? 1,
      };
    })
    .sort((first, second) =>
      question.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE ? 0 : first.sortOrder - second.sortOrder,
    );
}

export function isOptionQuotaQuestion(question = {}) {
  if (
    question.type !== QUESTION_TYPES.SINGLE_CHOICE &&
    question.type !== QUESTION_TYPES.DROPDOWN &&
    question.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE
  ) {
    return false;
  }

  return Object.keys(question.optionSettings ?? {}).length > 0;
}

// ─── 응답 항목 정렬/신청자 식별/슬롯 선택 ────────────────────────────────────

export function getOrderedResponseAnswerItems(questions = [], answers = []) {
  const questionMap = new Map(questions.map((question, index) => [question.id, { ...question, index }]));
  const normalizedAnswers = Array.isArray(answers) ? answers : [];
  const consumedIds = new Set();
  const items = [];

  questions.forEach((question, index) => {
    if (isNonResponseQuestionType(question.type)) return;

    const matchedAnswer = normalizedAnswers.find((answer) => answer?.questionId === question.id);

    if (matchedAnswer) {
      consumedIds.add(matchedAnswer.questionId);
      items.push({
        questionId: question.id,
        questionType: question.type,
        questionTitle: question.title,
        answer: matchedAnswer.answer,
        order: index,
      });
      return;
    }

    items.push({ questionId: question.id, questionType: question.type, questionTitle: question.title, answer: '', order: index });
  });

  normalizedAnswers.forEach((answer, index) => {
    if (answer?.questionId && consumedIds.has(answer.questionId)) return;
    const matchedQuestion = answer?.questionId ? questionMap.get(answer.questionId) : null;
    if (matchedQuestion && isNonResponseQuestionType(matchedQuestion.type)) return;

    items.push({
      questionId: answer?.questionId ?? `legacy-answer-${index + 1}`,
      questionType: matchedQuestion?.type ?? answer?.questionType ?? QUESTION_TYPES.SHORT_TEXT,
      questionTitle: matchedQuestion?.title ?? answer?.questionTitle ?? `질문 ${index + 1}`,
      answer: answer?.answer,
      order: matchedQuestion?.index ?? questions.length + index,
    });
  });

  return items.sort((first, second) => first.order - second.order);
}

function normalizePhoneNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

function normalizeApplicantName(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeApplicantBirthDate(value) {
  return String(value ?? '').trim();
}

export function extractApplicantIdentity(questions = [], answers = []) {
  const answerItems = getOrderedResponseAnswerItems(questions, answers);
  const findByType = (type) => answerItems.find((item) => item.questionType === type);
  const findByTitle = (patterns) =>
    answerItems.find((item) => patterns.some((pattern) => String(item.questionTitle ?? '').toLowerCase().includes(pattern)));

  const nameAnswer =
    findByTitle(['이름', '성명', 'name']) ?? answerItems.find((item) => item.questionType === QUESTION_TYPES.SHORT_TEXT);
  const phoneAnswer = findByType(QUESTION_TYPES.PHONE) ?? findByTitle(['연락처', '전화', '휴대폰', 'phone']);
  const birthAnswer =
    findByTitle(['생년월일', 'birth', '생일']) ??
    answerItems.find((item) => item.questionType === QUESTION_TYPES.DATE && String(item.questionTitle ?? '').includes('생'));

  const name = String(nameAnswer?.answer ?? '').trim();
  const phone = normalizePhoneNumber(phoneAnswer?.answer);
  const birthDate = normalizeApplicantBirthDate(birthAnswer?.answer);

  let applicantKey = '';
  let applicantKeyLabel = '';

  if (phone) {
    applicantKey = `phone:${phone}`;
    applicantKeyLabel = '연락처 기준';
  } else if (name && birthDate) {
    applicantKey = `name-birth:${normalizeApplicantName(name)}::${birthDate}`;
    applicantKeyLabel = '이름+생년월일 기준';
  }

  return { key: applicantKey, keyLabel: applicantKeyLabel, name, phone, birthDate };
}

export function extractSlotSelections(questions = [], answers = [], optionQuotaCounts = {}) {
  const answerItems = getOrderedResponseAnswerItems(questions, answers);

  return answerItems.reduce((result, answerItem) => {
    const matchedQuestion = questions.find((question) => question.id === answerItem.questionId);
    if (!matchedQuestion || matchedQuestion.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE) return result;

    const selectedValue = typeof answerItem.answer === 'string' ? answerItem.answer.trim() : '';
    if (!selectedValue) return result;

    const optionItem = getQuestionOptionItems(matchedQuestion, optionQuotaCounts).find((option) => option.value === selectedValue);

    result.push({
      questionId: matchedQuestion.id,
      questionTitle: matchedQuestion.title,
      slotValue: selectedValue,
      slotLabel: optionItem?.title || optionItem?.label || selectedValue,
    });

    return result;
  }, []);
}

// ─── answers[] PII 문항 식별(Phase 2, src/firebase/surveys.js identifyAnswerPiiQuestionIds 동일) ──

const PRIVACY_PII_KEYWORDS = [
  '이름', '성명', '성함',
  '연락처', '전화', '휴대폰', '핸드폰', '전화번호', '휴대전화',
  '이메일', '메일',
  '생년월일', '생일', '출생일', '출생연도',
  '나이', '연령',
  '주소', '거주지',
  '보호자', '부모', '법정대리인', '긴급연락처',
  '주민등록', '계좌', '신분증', '여권',
];

const INHERENTLY_PII_TYPES = new Set([QUESTION_TYPES.EMAIL, QUESTION_TYPES.PHONE]);

const ANSWER_PII_ELIGIBLE_TYPES = new Set([
  QUESTION_TYPES.SHORT_TEXT,
  QUESTION_TYPES.LONG_TEXT,
  QUESTION_TYPES.EMAIL,
  QUESTION_TYPES.PHONE,
  QUESTION_TYPES.DATE,
]);

export function identifyAnswerPiiQuestionIds(questions = []) {
  const questionList = Array.isArray(questions) ? questions : [];
  return new Set(
    questionList
      .filter((q) => {
        if (!q) return false;
        if (!ANSWER_PII_ELIGIBLE_TYPES.has(q.type)) return false;
        if (INHERENTLY_PII_TYPES.has(q.type)) return true;
        const title = String(q.title ?? '').toLowerCase();
        return PRIVACY_PII_KEYWORDS.some((kw) => title.includes(kw.toLowerCase()));
      })
      .map((q) => q.id),
  );
}

export function buildAnswerPiiTargets(questions, piiQuestionIds, answers) {
  if (!piiQuestionIds || piiQuestionIds.size === 0) return [];
  const questionMap = new Map((Array.isArray(questions) ? questions : []).map((q) => [q.id, q]));
  const targets = [];

  (Array.isArray(answers) ? answers : []).forEach((answerItem) => {
    if (!answerItem || !piiQuestionIds.has(answerItem.questionId)) return;

    const rawAnswer = answerItem.answer;
    const value =
      typeof rawAnswer === 'string' ? rawAnswer.trim() : Array.isArray(rawAnswer) ? rawAnswer.join(', ').trim() : '';
    if (!value) return;

    const question = questionMap.get(answerItem.questionId);
    targets.push({
      questionId: answerItem.questionId,
      value,
      questionTitle: question?.title ?? answerItem.questionTitle ?? '',
      questionType: question?.type ?? answerItem.questionType ?? '',
    });
  });

  return targets;
}

// ─── ID 생성(잠금 문서 · 응답 문서) ──────────────────────────────────────────
// hashString은 암호학적 해시가 아니다(32비트 다항 해시) — 기존 클라이언트 구현과 100% 동일한
// 알고리즘을 유지해야 한다. 알고리즘이 다르면 같은 신청자라도 잠금 문서 ID가 달라져 중복신청
// 방지가 무력화된다. src/firebase/surveys.js의 hashString()과 반드시 동일하게 유지할 것.
export function hashString(value) {
  return String(value ?? '')
    .split('')
    .reduce((hash, character) => {
      const nextHash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      return nextHash;
    }, 7)
    .toString(36);
}

function sanitizeDocumentId(value) {
  const sanitizedValue = String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return sanitizedValue || createLocalId('doc');
}

export function buildApplicantLockDocumentId(applicantKey) {
  return hashString(applicantKey);
}

export function buildApplicationSlotLockDocumentId(questionId, slotValue, applicantKey) {
  return `${questionId}__${hashString(`${slotValue}::${applicantKey}`)}`;
}

export function buildClientSubmitLockDocumentId(clientSubmitId) {
  return sanitizeDocumentId(clientSubmitId);
}

export function buildClientSubmitResponseDocumentId(surveyId, clientSubmitId) {
  return `${sanitizeDocumentId(surveyId)}__${sanitizeDocumentId(clientSubmitId)}`;
}
