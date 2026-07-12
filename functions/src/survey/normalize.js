/**
 * SYNC REQUIRED: src/firebase/surveyNormalize.js의 동일 함수와 로직을 동일하게 유지해야 한다.
 * 단, 이 파일은 "설문 제출(quota/중복신청/슬롯/PII)에 실제로 쓰이는 필드"만 정규화하는
 * 의도적으로 좁힌 버전이다 — 원본의 branching/visibilityConditions/scale settings 정규화는
 * 제출 트랜잭션 어디에서도 읽지 않으므로(클라이언트가 이미 계산해 보낸 visibleQuestionIds 등을
 * 그대로 신뢰하는 필드일 뿐, 서버 재계산 대상이 아님) 옮기지 않았다 — 최소 변경 원칙.
 * normalizeQuestionType의 별칭(alias) 표는 원본과 완전히 동일해야 한다.
 */

import { NON_RESPONSE_QUESTION_TYPES, QUESTION_TYPES, SELECTABLE_QUESTION_TYPES } from './constants.js';

const QUESTION_TYPE_ALIASES = {
  short_text: QUESTION_TYPES.SHORT_TEXT,
  short: QUESTION_TYPES.SHORT_TEXT,
  text: QUESTION_TYPES.SHORT_TEXT,
  input: QUESTION_TYPES.SHORT_TEXT,
  subjective_short: QUESTION_TYPES.SHORT_TEXT,
  long_text: QUESTION_TYPES.LONG_TEXT,
  long: QUESTION_TYPES.LONG_TEXT,
  textarea: QUESTION_TYPES.LONG_TEXT,
  paragraph: QUESTION_TYPES.LONG_TEXT,
  subjective: QUESTION_TYPES.LONG_TEXT,
  subjective_long: QUESTION_TYPES.LONG_TEXT,
  email: QUESTION_TYPES.EMAIL,
  phone: QUESTION_TYPES.PHONE,
  date: QUESTION_TYPES.DATE,
  time: QUESTION_TYPES.TIME,
  number: QUESTION_TYPES.NUMBER,
  linear_scale: QUESTION_TYPES.LINEAR_SCALE,
  scale: QUESTION_TYPES.LINEAR_SCALE,
  rating_scale: QUESTION_TYPES.RATING_SCALE,
  rating: QUESTION_TYPES.RATING_SCALE,
  nps_scale: QUESTION_TYPES.NPS_SCALE,
  nps: QUESTION_TYPES.NPS_SCALE,
  single_choice: QUESTION_TYPES.SINGLE_CHOICE,
  radio: QUESTION_TYPES.SINGLE_CHOICE,
  choice: QUESTION_TYPES.SINGLE_CHOICE,
  multiple_choice: QUESTION_TYPES.MULTIPLE_CHOICE,
  checkbox: QUESTION_TYPES.MULTIPLE_CHOICE,
  checkboxes: QUESTION_TYPES.MULTIPLE_CHOICE,
  dropdown: QUESTION_TYPES.DROPDOWN,
  select: QUESTION_TYPES.DROPDOWN,
  application_slot_choice: QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
  application_slot: QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
  slot: QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
  consent_checkbox: QUESTION_TYPES.CONSENT_CHECKBOX,
  consent: QUESTION_TYPES.CONSENT_CHECKBOX,
  privacy_consent: QUESTION_TYPES.CONSENT_CHECKBOX,
  description_block: QUESTION_TYPES.DESCRIPTION_BLOCK,
  description: QUESTION_TYPES.DESCRIPTION_BLOCK,
  안내문: QUESTION_TYPES.DESCRIPTION_BLOCK,
  section_title: QUESTION_TYPES.SECTION_TITLE,
  section: QUESTION_TYPES.SECTION_TITLE,
};

export function normalizeQuestionType(type) {
  if (Object.values(QUESTION_TYPES).includes(type)) {
    return type;
  }

  if (typeof type === 'string' && QUESTION_TYPE_ALIASES[type]) {
    return QUESTION_TYPE_ALIASES[type];
  }

  return QUESTION_TYPES.SHORT_TEXT;
}

export function isSelectableQuestionType(type) {
  return SELECTABLE_QUESTION_TYPES.has(normalizeQuestionType(type));
}

export function isNonResponseQuestionType(type) {
  return NON_RESPONSE_QUESTION_TYPES.has(normalizeQuestionType(type));
}

export function sanitizeQuestionOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (typeof option === 'string') {
        return option.trim();
      }

      if (option && typeof option === 'object') {
        return option.value?.trim?.() ?? option.label?.trim?.() ?? option.title?.trim?.() ?? '';
      }

      return '';
    })
    .filter(Boolean);
}

function normalizeQuestionTextField(primaryValue, secondaryValue) {
  return primaryValue?.trim?.() ?? secondaryValue?.trim?.() ?? '';
}

function normalizeQuestionId(id, index) {
  if (typeof id === 'string' && id.trim()) {
    return id.trim();
  }

  return `legacy-question-${index + 1}`;
}

export function normalizeOptionCapacity(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return Math.floor(numericValue);
}

export function normalizeSlotText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function normalizeSlotSortOrder(value, fallbackOrder = 1) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallbackOrder;
  }

  return Math.floor(numericValue);
}

function normalizeQuestionOptionSettings(question = {}, normalizedOptions = []) {
  const rawSettings =
    question.optionSettings && typeof question.optionSettings === 'object' && !Array.isArray(question.optionSettings)
      ? question.optionSettings
      : {};
  const questionType = normalizeQuestionType(question.type);

  return normalizedOptions.reduce((result, optionLabel, optionIndex) => {
    const legacyOptionObject = Array.isArray(question.options)
      ? question.options.find(
          (option) =>
            option &&
            typeof option === 'object' &&
            (option.value?.trim?.() ?? option.label?.trim?.() ?? option.title?.trim?.() ?? '') === optionLabel,
        )
      : null;
    const rawSetting = rawSettings[optionLabel] ?? legacyOptionObject ?? {};
    const capacity = normalizeOptionCapacity(rawSetting.capacity);

    const nextSetting = {};

    if (capacity) {
      nextSetting.capacity = capacity;
    }

    if (questionType === QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
      nextSetting.title = normalizeSlotText(rawSetting.title) || optionLabel;
      nextSetting.date = normalizeSlotText(rawSetting.date);
      nextSetting.time = normalizeSlotText(rawSetting.time);
      nextSetting.place = normalizeSlotText(rawSetting.place);
      nextSetting.ageGroup = normalizeSlotText(rawSetting.ageGroup);
      nextSetting.sortOrder = normalizeSlotSortOrder(rawSetting.sortOrder, optionIndex + 1);
    }

    if (Object.keys(nextSetting).length > 0) {
      result[optionLabel] = nextSetting;
    }

    return result;
  }, {});
}

/**
 * src/firebase/surveyNormalize.js의 normalizeQuestion()과 달리 branching/visibilityConditions/
 * scale settings는 계산하지 않는다(제출 트랜잭션이 읽지 않는 필드) — id/title/description/type/
 * options/optionSettings만 있으면 quota·중복신청·슬롯·PII 식별 로직이 전부 동작한다.
 */
export function normalizeQuestionForSubmission(question = {}, index = 0) {
  const type = normalizeQuestionType(question.type);
  const normalizedOptions = isSelectableQuestionType(type) ? sanitizeQuestionOptions(question.options) : [];
  const id = normalizeQuestionId(question.id, question.index ?? index);
  const title = normalizeQuestionTextField(question.title, question.label);
  const description = normalizeQuestionTextField(question.description, question.helpText);
  const optionSettings =
    type === QUESTION_TYPES.SINGLE_CHOICE ||
    type === QUESTION_TYPES.DROPDOWN ||
    type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE
      ? normalizeQuestionOptionSettings(question, normalizedOptions)
      : {};
  const sortedOptions =
    type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE
      ? [...normalizedOptions].sort((first, second) => {
          const firstOrder = normalizeSlotSortOrder(optionSettings?.[first]?.sortOrder, 1);
          const secondOrder = normalizeSlotSortOrder(optionSettings?.[second]?.sortOrder, 1);
          return firstOrder - secondOrder;
        })
      : normalizedOptions;

  return {
    id,
    title,
    description,
    type,
    options: sortedOptions,
    optionSettings,
  };
}

export function normalizeQuestionsForSubmission(questions = []) {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions.map((question, index) => normalizeQuestionForSubmission(question, index));
}
